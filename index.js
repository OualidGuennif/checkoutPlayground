/**
 * Adyen Checkout Example - Main Application
 */

const express = require("express");
const path = require("path");
const hbs = require("express-handlebars");
const morgan = require("morgan");

// Import configuration and validation
const { config, validateConfig } = require('./src/config');

// Import error handling
const { handleServerError } = require('./src/utils/errorHandler');

// Import controllers
const paymentsController = require('./src/controllers/paymentsController');
const webhooksController = require('./src/controllers/webhooksController');
const adyenService = require("./src/services/adyenService");

// Initialize Express app
const app = express();

// Validate configuration at startup
try {
  validateConfig();
  console.log('Configuration validated successfully');
} catch (error) {
  console.error('Configuration validation failed:', error.message);
  process.exit(1);
}

// Middleware setup
app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "/public")));

// Handlebars setup
app.engine(
  "handlebars",
  hbs.engine({
    defaultLayout: "main",
    layoutsDir: __dirname + "/views/layouts",
    partialsDir: [
      path.join(__dirname, "views/sessionFlow"),
      path.join(__dirname, "views/advancedFlow"),
    ],
    helpers: require("./util/helpers"),
  })
);




app.set("view engine", "handlebars");

/* ################# API ENDPOINTS ###################### */

// Payment endpoints
app.post("/api/sessions", paymentsController.createSession);
app.post("/api/paymentMethods", paymentsController.getPaymentMethods);
app.post("/api/payments", paymentsController.submitPayment);
app.post("/api/payments/details", paymentsController.submitPaymentDetails);
app.all("/handleShopperRedirect", paymentsController.handleShopperRedirect);
app.get("/api/payment-status/:orderRef", paymentsController.getPaymentStatus);
app.post("/api/recheck-payment-status", paymentsController.recheckPaymentStatus);
app.get("/api/debug/payment-statuses", paymentsController.getAllPaymentStatuses);
app.post("/api/paymentLinks", paymentsController.createPaymentLink);




// Webhook endpoints
app.post("/api/webhooks/notifications", webhooksController.processWebhook);

/* ################# CLIENT SIDE ENDPOINTS ###################### */

// Index page
app.get("/", (req, res) => res.render("index"));

// Components page
app.get("/components/sessionFlow", (req, res) => res.render("componentsSessionFlow"));
app.get("/components/advancedFlow", (req, res) => res.render("componentsAdvancedFlow"));



//PayByLink
app.get("/checkout/paybylink", (req, res) => {
  res.render("payByLink", {
    title: "Pay by Link (API)",
    showCountrySelector: true
  });
});




//unscheduledCardOnFile
app.get("/checkout/unscheduledCardOnFile", (req, res) => {
  res.render("unscheduledCardOnFile", {
    title: "Unscheduled payment using Adyen token",
    showCountrySelector: true
  });
});


/* ===========================================================
   CARD
   =========================================================== */
app.get("/checkout/card/sessionFlow", (req, res) =>
  res.render("sessionFlow/card", {
    clientKey: config.adyen.ADYEN_CLIENT_KEY,
    showCountrySelector: true
  })
);

app.get("/checkout/card/advancedFlow", (req, res) =>
  res.render("advancedFlow/card", {
    clientKey: config.adyen.ADYEN_CLIENT_KEY,
    showCountrySelector: true
  })
);

/* ===========================================================
   DROP-IN
   =========================================================== */
app.get("/checkout/dropin/sessionFlow", (req, res) =>
  res.render("sessionFlow/dropin", {
    clientKey: config.adyen.ADYEN_CLIENT_KEY,
    showCountrySelector: true
  })
);

app.get("/checkout/dropin/advancedFlow", (req, res) =>
  res.render("advancedFlow/dropin", {
    clientKey: config.adyen.ADYEN_CLIENT_KEY,
    showCountrySelector: true
    
  })
);

/* ===========================================================
   IDEAL
   =========================================================== */
app.get("/checkout/ideal/sessionFlow", (req, res) =>
  res.render("sessionFlow/ideal", {
    clientKey: config.adyen.ADYEN_CLIENT_KEY
  })
);

app.get("/checkout/ideal/advancedFlow", (req, res) =>
  res.render("advancedFlow/ideal", {
    clientKey: config.adyen.ADYEN_CLIENT_KEY
  })
);

/* ===========================================================
   KLARNA
   =========================================================== */
app.get("/checkout/klarna/sessionFlow", (req, res) =>
  res.render("sessionFlow/klarna", {
    clientKey: config.adyen.ADYEN_CLIENT_KEY,
    showCountrySelector: true
  })
);

app.get("/checkout/klarna/advancedFlow", (req, res) =>
  res.render("advancedFlow/klarna", {
    clientKey: config.adyen.ADYEN_CLIENT_KEY,
    showCountrySelector: true
  })
);

/* ===========================================================
   SEPA
   =========================================================== */
app.get("/checkout/sepa/sessionFlow", (req, res) =>
  res.render("sessionFlow/sepa", {
    clientKey: config.adyen.ADYEN_CLIENT_KEY,
    showCountrySelector: true
  })
);

app.get("/checkout/sepa/advancedFlow", (req, res) =>
  res.render("advancedFlow/sepa", {
    clientKey: config.adyen.ADYEN_CLIENT_KEY,
    showCountrySelector: true
  })
);

/* ===========================================================
   VIPPS
   =========================================================== */
app.get("/checkout/vipps/sessionFlow", (req, res) =>
  res.render("sessionFlow/vipps", {
    clientKey: config.adyen.ADYEN_CLIENT_KEY
  })
);

app.get("/checkout/vipps/advancedFlow", (req, res) =>
  res.render("advancedFlow/vipps", {
    clientKey: config.adyen.ADYEN_CLIENT_KEY
  })
);

/* ===========================================================
   MOBILEPAY
   =========================================================== */
app.get("/checkout/mobilepay/sessionFlow", (req, res) =>
  res.render("sessionFlow/mobilepay", {
    clientKey: config.adyen.ADYEN_CLIENT_KEY,
    showCountrySelector: true
  })
);

app.get("/checkout/mobilepay/advancedFlow", (req, res) =>
  res.render("advancedFlow/mobilepay", {
    clientKey: config.adyen.ADYEN_CLIENT_KEY,
    showCountrySelector: true
  })
);

/* ===========================================================
   GOOGLE PAY
   =========================================================== */
app.get("/checkout/googlepay/sessionFlow", (req, res) =>
  res.render("sessionFlow/googlepay", {
    clientKey: config.adyen.ADYEN_CLIENT_KEY,
    showCountrySelector: true
  })
);

app.get("/checkout/googlepay/advancedFlow", (req, res) =>
  res.render("advancedFlow/googlepay", {
    clientKey: config.adyen.ADYEN_CLIENT_KEY,
    showCountrySelector: true
  })
);

/* ===========================================================
   APPLE PAY
   =========================================================== */
app.get("/checkout/applepay/sessionFlow", (req, res) =>
  res.render("sessionFlow/applepay", {
    clientKey: config.adyen.ADYEN_CLIENT_KEY,
    showCountrySelector: true
  })
);

app.get("/checkout/applepay/advancedFlow", (req, res) =>
  res.render("advancedFlow/applepay", {
    clientKey: config.adyen.ADYEN_CLIENT_KEY,
    showCountrySelector: true
  })
);


/* ################# RESULT PAGE ###################### */

app.get("/result/:type", (req, res) =>
  res.render("result", {
    type: req.params.type,
    orderRef: req.query.orderRef || 'N/A',
    redirectData: req.query.redirectData || null
  })
);

/* ################# ERROR HANDLING ###################### */

// Global error handler middleware (must be last)
app.use(handleServerError);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    code: 'NOT_FOUND',
    path: req.path
  });
});

/* ################# SERVER STARTUP ###################### */

const port = config.server.port;
app.listen(port, () => {
  console.log(`Server started -> http://localhost:${port}`);
  console.log(`Environment: ${config.server.environment}`);
  console.log(`Adyen Environment: ${config.adyen.ADYEN_ENVIRONMENT}`);
  console.log(`Base URL: ${config.server.baseUrl || 'auto-detected'}`);
});