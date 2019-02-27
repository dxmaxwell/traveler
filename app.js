/*jslint es5: true*/

var express = require('express');
var routes = require('./routes');
var http = require('http');
var https = require('https');
var multer = require('multer');
var path = require('path');

var bodyParser = require('body-parser');
var cookieParser = require('cookie-parser');
var compression = require('compression');
var errorHandler = require('errorhandler')
var session = require('express-session');
var favicon = require('serve-favicon');
var methodOverride = require('method-override');
var morgan = require('morgan');

var rotator = require('file-stream-rotator');

var config = require('./config/config.js');

var mongoose = require('mongoose');
mongoose.connection.close();

require('./model/user.js');
require('./model/form.js');
require('./model/traveler.js');
require('./model/binder.js');

var mongoOptions = config.mongo.options || {};

// configure Mongoose (MongoDB)
var mongoURL = 'mongodb://';
if (config.mongo.user) {
  mongoURL += encodeURIComponent(String(config.mongo.user));
  if (config.mongo.pass) {
    mongoURL += ':' + encodeURIComponent(String(config.mongo.pass));
  }
  mongoURL += '@';
}
if (!config.mongo.host) {
  config.mongo.host = String(config.mongo.address || 'localhost') + ':' + String(config.mongo.port || 27017);
}
mongoURL +=  config.mongo.host + '/' + String(config.mongo.db || 'traveler-dev');

// Remove password from the MongoDB URL to avoid logging the password!
console.log('Mongoose connection URL: %s', mongoURL.replace(/\/\/(.*):(.*)@/, '//$1:<password>@'));

mongoose.connect(mongoURL, mongoOptions);

mongoose.connection.on('connected', function () {
  console.log('Mongoose default connection opened.');
});

mongoose.connection.on('error', function (err) {
  console.log('Mongoose default connection error: ' + err);
});

mongoose.connection.on('disconnected', function () {
  console.log('Mongoose default connection disconnected');
});

var adClient = require('./lib/ldap-client').client;
adClient.on('connect', function () {
  console.log('ldap client connected');
});
adClient.on('timeout', function (message) {
  console.error(message);
});
adClient.on('error', function (error) {
  console.error(error);
});

var auth = require('./lib/auth');

var app = express();

var api = express();

app.enable('strict routing');

if (app.get('env') === 'production') {
  var access_logfile = rotator.getStream({
    filename: path.resolve(config.app.log_dir, 'access.log'),
    frequency: 'daily'
  });
}

{
  app.set('port', process.env.PORT || config.app.port);
  app.set('views', __dirname + '/views');
  app.set('view engine', 'jade');
  if (app.get('env') === 'production') {
    app.use(morgan({
      stream: access_logfile
    }));
  }
  app.use(compression());
  app.use(express.static(path.join(__dirname, 'public')));
  app.use(favicon(__dirname + '/public/favicon.ico'));
  if (app.get('env') === 'development') {
    app.use(morgan('dev'));
  }
  app.use(methodOverride());
  app.use(cookieParser());
  app.use(session({
    secret: config.app.cookie_sec || 'traveler_secret',
    cookie: {
      maxAge: config.app.cookie_life || 28800000
    }
  }));
  app.use(multer({
    dest: config.app.upload_dir,
    limits: {
      files: 1,
      fileSize: (config.app.upload_size || 10) * 1024 * 1024
    }
  }).any());
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded());
  app.use(auth.proxied);
  app.use(auth.sessionLocals);
  // api.use(api.router); // not supported in Express 4.X
}


require('./routes/form')(app);

require('./routes/traveler')(app);

require('./routes/binder')(app);

require('./routes/admin')(app);

require('./routes/user')(app);

require('./routes/profile')(app);

require('./routes/device')(app);

require('./routes/doc')(app);

app.get('/api', function (req, res) {
  res.render('api', {
    prefix: req.proxied ? req.proxied_prefix : ''
  });
});
app.get('/', routes.main);
app.get('/login', auth.ensureAuthenticated, function (req, res) {
  if (req.session.userid) {
    return res.redirect(req.proxied ? auth.proxied_service : '/');
  }
  // something wrong
  res.send(400, 'please enable cookie in your browser');
});
app.get('/logout', routes.logout);
app.get('/apis', function (req, res) {
  res.redirect('https://' + req.host + ':' + api.get('port') + req.originalUrl);
});

if (app.get('env') === 'development') {
  app.use(errorHandler());
}

api.enable('strict routing');
{
  api.set('port', process.env.APIPORT || config.api.port);
  api.use(morgan('dev'));
  // api.use(morgan({stream: access_logfile}));
  api.use(auth.basicAuth);
  api.use(compression());
  // api.use(api.router); // not supported in Express 4.X
};

require('./routes/api')(api);

var server = http.createServer(app).listen(app.get('port'), function () {
  console.log('Express server listening on port ' + app.get('port'));
});

var apiserver = https.createServer(config.api.credentials, api).listen(api.get('port'), function () {
  console.log('API server listening on port ' + api.get('port'));
});

function cleanup() {
  server._connections = 0;
  apiserver._connections = 0;
  mongoose.connection.close();
  adClient.unbind(function () {
    console.log('ldap client stops.');
  });
  server.close(function () {
    apiserver.close(function () {
      console.log('web and api servers close.');
      // Close db connections, other chores, etc.
      process.exit();
    });
  });

  setTimeout(function () {
    console.error('Could not close connections in time, forcing shut down');
    process.exit(1);
  }, 30 * 1000);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
