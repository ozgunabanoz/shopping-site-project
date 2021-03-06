const fs = require('fs');
const path = require('path');

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const PDFDocument = require('pdfkit');

const Product = require('../models/product');
const Order = require('../models/order');

const ITEMS_PER_PAGE = 3;

exports.getProducts = async (req, res, next) => {
  let products;
  const page = +req.query.page || 1;
  let totalItems;

  try {
    totalItems = await Product.countDocuments();
    products = await Product.find()
      .skip((page - 1) * ITEMS_PER_PAGE)
      .limit(ITEMS_PER_PAGE);

    res.render('shop/product-list', {
      prods: products,
      pageTitle: 'All Products',
      path: '/products',
      currentPage: page,
      hasNextPage: ITEMS_PER_PAGE * page < totalItems,
      hasPrevPage: page > 1,
      nextPage: page + 1,
      prevPage: page - 1,
      lastPage: Math.ceil(totalItems / ITEMS_PER_PAGE)
    });
  } catch (err) {
    let error = new Error(err);

    error.httpStatusCode = 500;

    return next(error);
  }
};

exports.getProduct = async (req, res, next) => {
  const prodId = req.params.productId;
  let product;

  try {
    product = await Product.findById(prodId);

    res.render('shop/product-detail', {
      product: product,
      pageTitle: product.title,
      path: '/products'
    });
  } catch (err) {
    let error = new Error(err);

    error.httpStatusCode = 500;

    return next(error);
  }
};

exports.getIndex = async (req, res, next) => {
  const page = +req.query.page || 1;
  let products;
  let totalItems;

  try {
    totalItems = await Product.countDocuments();
    products = await Product.find()
      .skip((page - 1) * ITEMS_PER_PAGE)
      .limit(ITEMS_PER_PAGE);

    res.render('shop/index', {
      prods: products,
      pageTitle: 'Shop',
      path: '/',
      currentPage: page,
      hasNextPage: ITEMS_PER_PAGE * page < totalItems,
      hasPrevPage: page > 1,
      nextPage: page + 1,
      prevPage: page - 1,
      lastPage: Math.ceil(totalItems / ITEMS_PER_PAGE)
    });
  } catch (err) {
    let error = new Error(err);

    error.httpStatusCode = 500;

    return next(error);
  }
};

exports.getCart = async (req, res, next) => {
  let user;
  let products = [];

  try {
    user = await req.user
      .populate('cart.items.productId')
      .execPopulate();
    products = user.cart.items;

    res.render('shop/cart', {
      path: '/cart',
      pageTitle: 'Your Cart',
      products: products
    });
  } catch (err) {
    let error = new Error(err);

    error.httpStatusCode = 500;

    return next(error);
  }
};

exports.postCart = async (req, res, next) => {
  const prodId = req.body.productId;
  let product;

  try {
    product = await Product.findById(prodId);

    await req.user.addToCart(product);
    res.redirect('/cart');
  } catch (err) {
    let error = new Error(err);

    error.httpStatusCode = 500;

    return next(error);
  }
};

exports.postCartDeleteProduct = async (req, res, next) => {
  const prodId = req.body.productId;

  try {
    await req.user.deleteItemFromCart(prodId);

    res.redirect('/cart');
  } catch (err) {
    let error = new Error(err);

    error.httpStatusCode = 500;

    return next(error);
  }
};

exports.postOrder = async (req, res, next) => {
  let user;
  let products;

  try {
    user = await req.user
      .populate('cart.items.productId')
      .execPopulate();
    products = user.cart.items.map(i => {
      return {
        quantity: i.quantity,
        productData: { ...i.productId._doc }
      };
    });

    const order = new Order({
      user: {
        email: req.user.email,
        userId: req.user
      },
      products
    });

    await order.save();
    await req.user.clearCart();
    res.redirect('/orders');
  } catch (err) {
    let error = new Error(err);

    error.httpStatusCode = 500;

    return next(error);
  }
};

exports.getOrders = async (req, res, next) => {
  let orders;

  try {
    orders = await Order.find({
      'user.userId': req.user._id
    });

    res.render('shop/orders', {
      path: '/orders',
      pageTitle: 'Your Orders',
      orders
    });
  } catch (err) {
    let error = new Error(err);

    error.httpStatusCode = 500;

    return next(error);
  }
};

exports.getInvoice = async (req, res, next) => {
  const orderId = req.params.orderId;
  let order;

  try {
    order = await Order.findById(orderId);

    if (!order) {
      return next(new Error('No order found'));
    }

    if (order.user.userId.toString() !== req.user._id.toString()) {
      return next(new Error('Unauthorized'));
    }

    const invoiceName = `invoice-${orderId}.pdf`;
    const invoicePath = path.join('data', 'invoices', invoiceName);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${invoiceName}"`
    );

    const pdfDoc = new PDFDocument();

    pdfDoc.pipe(fs.createWriteStream(invoicePath));
    pdfDoc.pipe(res);

    pdfDoc.fontSize(20).text('Invoice', { underline: true });

    let totalPrice = 0;

    order.products.forEach(product => {
      totalPrice =
        totalPrice + product.productData.price * product.quantity;

      pdfDoc.moveDown();
      pdfDoc
        .fontSize(14)
        .text(
          `Product: ${product.productData.title} - Quantity: ${
            product.quantity
          } Price: $${product.productData.price}`
        );
    });

    pdfDoc.moveDown();
    pdfDoc.fontSize(12).text(`Total price: $${totalPrice}`);

    pdfDoc.end();
  } catch (err) {
    next(err);
  }
};

exports.getCheckout = async (req, res, next) => {
  let user;
  let products = [];
  let session;

  try {
    user = await req.user
      .populate('cart.items.productId')
      .execPopulate();
    products = user.cart.items;

    let totalSum = 0;

    products.forEach(p => {
      totalSum += p.quantity * p.productId.price;
    });

    session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: products.map(p => {
        return {
          name: p.productId.title,
          description: p.productId.description,
          amount: p.productId.price * 100,
          currency: 'usd',
          quantity: p.quantity
        };
      }),
      success_url: `${req.protocol}://${req.get(
        'host'
      )}/checkout/success`,
      cancel_url: `${req.protocol}://${req.get(
        'host'
      )}/checkout/cancel`
    });

    res.render('shop/checkout', {
      path: '/checkout',
      pageTitle: 'Checkout',
      products: products,
      totalSum,
      sessionId: session.id
    });
  } catch (err) {
    let error = new Error(err);

    error.httpStatusCode = 500;

    return next(error);
  }
};

exports.getCheckoutSuccess = async (req, res, next) => {
  let user;
  let products;

  try {
    user = await req.user
      .populate('cart.items.productId')
      .execPopulate();
    products = user.cart.items.map(i => {
      return {
        quantity: i.quantity,
        productData: { ...i.productId._doc }
      };
    });

    const order = new Order({
      user: {
        email: req.user.email,
        userId: req.user
      },
      products
    });

    await order.save();
    await req.user.clearCart();
    res.redirect('/orders');
  } catch (err) {
    let error = new Error(err);

    error.httpStatusCode = 500;

    return next(error);
  }
};
