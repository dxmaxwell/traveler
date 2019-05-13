/**
 * Start and configure the web application.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import * as url from 'url';
import * as util from 'util';

// Required syntax because the type declaration uses 'export = rc;'.
// (See: https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/types/rc/index.d.ts)
import rc = require('rc');

import * as bodyparser from 'body-parser';
import * as compression from 'compression';
import * as express from 'express';
import * as session from 'express-session';
import * as methodOverride from 'method-override';
import * as mongoose from 'mongoose';
import * as morgan from 'morgan';
import * as favicon from 'serve-favicon';

import * as auth from './lib/auth';
import Uploader from './lib/uploader';

// import * as auth from './shared/auth';
import * as handlers from './shared/handlers';
import * as logging from './shared/logging';
import * as promises from './shared/promises';
import * as status from './shared/status';
import * as tasks from './shared/tasks';

import * as ldapjs from './lib/ldap-client';
import * as share from './lib/share';

import * as admin from './routes/admin';
import * as api from './routes/api';
import * as binder from './routes/binder';
// import device from './routes/device';
import * as doc from './routes/doc';
import * as form from './routes/form';
import * as profile from './routes/profile';
import * as traveler from './routes/traveler';
import * as user from './routes/user';


// package metadata
interface Package {
  name?: {};
  version?: {};
}

// application configuration
interface Config {
  // these properties are provided by the 'rc' library
  // and contain config file paths that have been read
  // (see https://www.npmjs.com/package/rc)
  config?: string;
  configs?: string[];
  app: {
    port: {};
    addr: {};
    trust_proxy: {};
    session_life: {};
    session_secret: {};
    web_env?: {};
  };
  mongo: {
    user?: {};
    pass?: {};
    host?: {};
    port: {};
    addr: {};
    db: {};
    options: {};
  };
  ad: {
    url?: {};
    adminDn?: {};
    adminPassword?: {};
    searchBase?: {};
    searchFilter?: {};
    nameFilter?: {};
    groupSearchBase?: {};
    groupSearchFilter?: {};
    objAttributes?: {};
    memberAttributes?: {};
    groupAttributes?: {};
    rawAttributes?: {};
  };
  cas: {
    cas_url?: {};
    service_url?: {};
    service_base_url?: {};
  };
  aliases: {
    [key: string]: string  | undefined;
  };
  apiusers: {
    [key: string]: string | undefined;
  };
  userphotos: {
    root?: {};
    maxAge: {};
  };
  uploads: {
    root?: {};
    maxSize: {};
  };
}

// application states (same as tasks.State, but avoids the dependency)
export type State = 'STARTING' | 'STARTED' | 'STOPPING' | 'STOPPED';

// application singleton
let app: express.Application;

// AD Client
let adClient: ldapjs.Client | null = null;

// application logging
export let info = logging.info;
export let warn = logging.warn;
export let error = logging.error;

// application lifecycle
const task = new tasks.StandardTask<express.Application>(doStart, doStop);

// default photo data
const defaultUserPhotoPath = path.resolve(__dirname, '..', 'public', 'images', 'photos', 'default.jpeg');

// application activity
const activeLimit = 100;
const activeResponses = new Set<express.Response>();
const activeSockets = new Set<net.Socket>();
let activeFinished = Promise.resolve();

const stat = util.promisify(fs.stat);
const mkdir = util.promisify(fs.mkdir);
const readFile = util.promisify(fs.readFile);

// read the application name and version
async function readNameVersion(): Promise<[string | undefined, string | undefined]> {
  // first look for application name and version in the environment
  let name = process.env.NODE_APP_NAME;
  let version = process.env.NODE_APP_VERSION;
  // second look for application name and verison in package.json
  if (!name || !version) {
    const pkgPath = path.resolve(__dirname, 'version.json');
    let pkg: Package | undefined;
    try {
      pkg = JSON.parse(await readFile(pkgPath, 'UTF-8'));
    } catch (err) {
      warn('Missing or invalid package metadata: %s: %s', pkgPath, err);
    }
    if (!name && pkg && pkg.name) {
      name = String(pkg.name);
    } else {
      name = String(name);
    }
    if (!version && pkg && pkg.version) {
      version = String(pkg.version);
    } else {
      version = String(version);
    }
  }
  return [name, version];
}

// get the application state
export function getState(): State {
  return task.getState();
}

// asynchronously start the application
export function start(): Promise<express.Application> {
  return task.start();
}

// asynchronously configure the application
async function doStart(): Promise<express.Application> {

  info('Application starting');

  app = express();

  app.enable('strict routing');

  const [name, version] = await readNameVersion();
  app.set('name', name);
  app.set('version', version);

  activeSockets.clear();
  activeResponses.clear();

  function updateActivityStatus(): void {
    if (activeResponses.size <= activeLimit) {
      status.setComponentOk('Activity', activeResponses.size + ' <= ' + activeLimit);
    } else {
      status.setComponentError('Activity', activeResponses.size + ' > ' + activeLimit);
    }
  }

  activeFinished = new Promise((resolve) => {
    app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (task.getState() !== 'STARTED') {
        res.status(503).end('Application ' + task.getState());
        return;
      }

      if (!activeResponses.has(res)) {
        activeResponses.add(res);
        updateActivityStatus();
        res.on('finish', () => {
          if (!activeResponses.delete(res)) {
            warn('Response is NOT active!');
          }
          updateActivityStatus();
          if (task.getState() === 'STOPPING' && activeResponses.size <= 0) {
            resolve();
          }
        });
      } else {
        warn('Response is ALREADY active!');
      }

      const socket = res.connection;
      if (!activeSockets.has(socket)) {
        activeSockets.add(socket);
        socket.on('close', () => {
          if (!activeSockets.delete(socket)) {
            warn('Socket is NOT active!');
          }
        });
      }

      next();
    });
  });

  const env: {} | undefined = app.get('env');
  info('Deployment environment: \'%s\'', env);

  const cfg: Config = {
    app: {
      port: '3000',
      addr: 'localhost',
      trust_proxy: false,
      session_life: 3600000,
      session_secret: crypto.randomBytes(50).toString('base64'),
    },
    mongo: {
      port: '27017',
      addr: 'localhost',
      db: 'webapp-dev',
      options: {
        // see http://mongoosejs.com/docs/connections.html
        useNewUrlParser: true,
      },
    },
    ad: {
      // no defaults
    },
    cas: {
      // no defaults
    },
    aliases: {
      // no defaults
    },
    apiusers: {
      // no defaults
    },
    userphotos: {
      maxAge: 30 * 24 * 3600, // 30 days
    },
    uploads: {
      maxSize: 10, // 10MB
    },
  };

  if (name && (typeof name === 'string')) {
    rc(name, cfg);
    if (cfg.configs) {
      for (const file of cfg.configs) {
        info('Load configuration: %s', file);
      }
    }
  }

  // Configure the server bind address and port
  app.set('port', String(cfg.app.port));
  app.set('addr', String(cfg.app.addr));

  // Proxy configuration (https://expressjs.com/en/guide/behind-proxies.html)
  app.set('trust proxy', cfg.app.trust_proxy || false);

  // Status monitor start
  await status.monitor.start();
  info('Status monitor started');

  // configure Mongoose (MongoDB)
  let mongoUrl = 'mongodb://';
  if (cfg.mongo.user) {
    mongoUrl += encodeURIComponent(String(cfg.mongo.user));
    if (cfg.mongo.pass) {
      mongoUrl += ':' + encodeURIComponent(String(cfg.mongo.pass));
    }
    mongoUrl += '@';
  }
  if (!cfg.mongo.host) {
    cfg.mongo.host = `${cfg.mongo.addr}:${cfg.mongo.port}`;
  }
  mongoUrl +=  `${cfg.mongo.host}/${cfg.mongo.db}`;

  // Remove password from the MongoDB URL to avoid logging the password!
  info('Mongoose connection URL: %s', mongoUrl.replace(/\/\/(.*):(.*)@/, '//$1:<password>@'));

  if (mongoose.Promise !== global.Promise) {
    // Mongoose 5.x should use ES6 Promises by default!
    throw new Error('Mongoose is not using native ES6 Promises!');
  }

  status.setComponentError('MongoDB', 'Never Connected');
  info('Mongoose connection: Never Connected');

  // NOTE: Registering a listener for the 'error' event
  // suppresses error reporting from the connect() method.
  // Therefore call connect() BEFORE registering listeners!
  await mongoose.connect(mongoUrl, cfg.mongo.options);

  status.setComponentOk('MongoDB', 'Connected');
  info('Mongoose connection: Connected');

  mongoose.connection.on('connected', () => {
    status.setComponentOk('MongoDB', 'Connected');
    info('Mongoose connection: Connected');
  });

  mongoose.connection.on('disconnected', () => {
    status.setComponentError('MongoDB', 'Disconnected');
    warn('Mongoose connection: Disconnected');
  });

  mongoose.connection.on('timeout', () => {
    status.setComponentError('MongoDB', 'Timeout');
    info('Mongoose connection: Timeout');
  });

  mongoose.connection.on('reconnect', () => {
    status.setComponentOk('MongoDB', 'Reconnected');
    info('Mongoose connection: Reconnected');
  });

  mongoose.connection.on('close', () => {
    status.setComponentError('MongoDB', 'Closed');
    warn('Mongoose connection: Closed');
  });

  mongoose.connection.on('reconnectFailed', () => {
    status.setComponentError('MongoDB', 'Reconnect Failed (Restart Required)');
    error('Mongoose connection: Reconnect Failed');
    // Mongoose has stopped attempting to reconnect,
    // so initiate appliction shutdown with the
    // expectation that systemd will auto restart.
    error('Sending Shutdown signal: SIGINT');
    process.kill(process.pid, 'SIGINT');
  });

  mongoose.connection.on('error', (err) => {
    status.setComponentError('MongoDB', '%s', err);
    error('Mongoose connection error: %s', err);
  });

  // Authentication Configuration
  adClient = await ldapjs.Client.create({
    url: String(cfg.ad.url),
    bindDN: String(cfg.ad.adminDn),
    bindCredentials: String(cfg.ad.adminPassword),
    // TODO: Move to external configuration //
    reconnect: true,
    timeout: 15 * 1000,
    idleTimeout: 10 * 1000,
    connectTimeout: 10 * 1000,
    //////////////////////////////////////////
  });
  info('LDAP client connected: %s', cfg.ad.url);
  status.setComponentOk('LDAP Client', 'Connected');

  adClient.on('connect', () => {
    info('LDAP client reconnected: %s', cfg.ad.url);
    status.setComponentOk('LDAP Client', 'Reconnected');
  });

  adClient.on('idle', () => {
    info('LDAP client connection is idle');
  });

  adClient.on('close', () => {
    warn('LDAP client connection is closed');
  });

  adClient.on('error', (err) => {
    error('LDAP client connection: %s', err);
  });

  adClient.on('quietError', (err) => {
    status.setComponentError('LDAP Client', '%s', err);
  });

  auth.setADConfig({
    objAttributes: Array.isArray(cfg.ad.objAttributes) ? cfg.ad.objAttributes.map(String) : [],
    searchBase: String(cfg.ad.searchBase),
    searchFilter: String(cfg.ad.searchFilter),
    memberAttributes: Array.isArray(cfg.ad.memberAttributes) ? cfg.ad.memberAttributes.map(String) : [],
  });

  auth.setAuthConfig({
    cas: String(cfg.cas.cas_url),
    // Need to resolve the service URL using same method as the `passport-cas` library
    service: url.resolve(String(cfg.cas.service_base_url), String(cfg.cas.service_url)),
  });

  auth.setAliases(cfg.aliases);

  auth.setAPIUsers(cfg.apiusers);

  auth.setLDAPClient(adClient);

  // Configure the user photo cache directory
  if (!cfg.userphotos.root) {
    throw new Error(`User photo cache root directory path is required`);
  }
  try {
    const finfo = await stat(String(cfg.userphotos.root));
    if (!finfo.isDirectory()) {
      throw new Error(`User photo cache root is not a directory: ${cfg.userphotos.root}`);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
    await mkdir(String(cfg.userphotos.root), { recursive: true });
  }
  info('User photo cache root: %s', cfg.userphotos.root);
  info('User photo cache max age: %s', cfg.userphotos.maxAge);

  // Configure the file uploads directory
  if (!cfg.uploads.root) {
    throw new Error(`File uploads root directory path is required`);
  }
  try {
    const finfo = await stat(String(cfg.uploads.root));
    if (!finfo.isDirectory()) {
      throw new Error(`File uploads root is not a directory: ${cfg.uploads.root}`);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
    await mkdir(String(cfg.uploads.root), { recursive: true });
  }
  info('File uploads root: %s', cfg.uploads.root);
  info('File uploads max size: %s', cfg.uploads.maxSize);

  // Default user photo configuration
  const defaultUserPhotoType = 'image/jpeg';
  const defaultUserPhotoData = await readFile(defaultUserPhotoPath);

  user.setDefaultUserPhotoType(defaultUserPhotoType);
  user.setDefaultUserPhotoData(defaultUserPhotoData);

  // view engine configuration
  app.set('views', path.resolve(__dirname, '..', 'views'));
  app.set('view engine', 'pug');
  app.set('view cache', (env === 'production') ? true : false);

  // Configure 'webenv' property and add to response locals
  const webenv = cfg.app.web_env || process.env.WEB_ENV || 'development';
  info('Web environment: \'%s\'', webenv);
  app.set('webenv', webenv);
  app.use((req, res, next) => {
    res.locals.webenv = webenv;
    next();
  });

  // Configure file uploader
  const uploader = Uploader({
    dest: String(cfg.uploads.root),
    limits: {
      files: 1,
      fileSize: Number(cfg.uploads.maxSize) * 1024 * 1024,
    },
  });
  form.setUploader(uploader);
  traveler.setUploader(uploader);

  // Session configuration
  app.use(session({
    store: new session.MemoryStore(),
    resave: false,
    saveUninitialized: false,
    secret: String(cfg.app.session_secret),
    cookie: {
      maxAge: Number(cfg.app.session_life),
    },
  }));

  // Add session to response locals
  app.use(auth.sessionLocals);

  // Authentication handlers (must follow session middleware)
  // app.use(auth.getProvider().initialize()); // requires ./shared/auth.ts

  // Request logging configuration (must follow authc middleware)
  // morgan.token('remote-user', (req) => {    // requires ./shared/auth.ts
  //   const username = auth.getUsername(req);
  //   return username || 'anonymous';
  // });

  if (env === 'production') {
    app.use(morgan('short'));
  } else {
    app.use(morgan('dev'));
  }

  // favicon configuration
  app.use(favicon(path.resolve(__dirname, '..', 'public', 'favicon.ico')));

  // static file configuration
  app.use(express.static(path.resolve(__dirname, '..', 'public')));

  // Redirect requests ending in '/' and set response locals 'basePath'
  app.use(handlers.basePathHandler());

  // Legacy middleware (consider removing) //

  // Compress response bodies
  app.use(compression());

  // PUT and DELETE method support for old browsers
  app.use(methodOverride());
  //////////////////////////////////////////

  // body-parser configuration
  app.use(bodyparser.json());
  app.use(bodyparser.urlencoded({
    extended: false,
  }));

  app.get('/login', auth.ensureAuthenticated, (req, res) => {
    if (!req.session) {
      res.status(500).send('session missing');
      return;
    }
    if (req.session.landing && req.session.landing !== req.url) {
      res.redirect(res.locals.basePath + req.session.landing);
      return;
    }
    res.redirect(res.locals.basePath || '/');
  });

  app.get('/logout', (req, res) => {
    // auth.getProvider().logout(req);  // requires ./shared/auth.ts
    if (req.session) {
      req.session.destroy((err) => {
        if (err) {
          error(err);
        }
      });
    }
    res.redirect(`${cfg.cas.cas_url}/logout`);
  });

  app.use('/status', status.router);

  // Configure application routes
  app.get('/', (req, res) => {
    res.render('main');
  });

  share.setADConfig({
    groupAttributes: Array.isArray(cfg.ad.groupAttributes) ? cfg.ad.groupAttributes.map(String) : [],
    groupSearchBase: cfg.ad.groupSearchBase ? String(cfg.ad.groupSearchBase) : '',
    groupSearchFilter: cfg.ad.groupSearchFilter ? String(cfg.ad.groupSearchFilter) : '',
    searchBase: cfg.ad.searchBase ? String(cfg.ad.searchBase) : '',
    nameFilter: cfg.ad.nameFilter ? String(cfg.ad.nameFilter) : '',
    objAttributes: Array.isArray(cfg.ad.objAttributes) ? cfg.ad.objAttributes.map(String) : [],
  });
  share.setLDAPClient(adClient);

  form.setServiceUrl(String(cfg.cas.service_base_url));
  form.init(app);

  traveler.setServiceUrl(String(cfg.cas.service_base_url));
  traveler.init(app);

  binder.setServiceUrl(String(cfg.cas.service_base_url));
  binder.init(app);

  admin.init(app);

  user.setADConfig({
    groupAttributes: Array.isArray(cfg.ad.groupAttributes) ? cfg.ad.groupAttributes.map(String) : [],
    groupSearchBase: cfg.ad.groupSearchBase ? String(cfg.ad.groupSearchBase) : '',
    groupSearchFilter: cfg.ad.groupSearchFilter ? String(cfg.ad.groupSearchFilter) : '',
    nameFilter: cfg.ad.nameFilter ? String(cfg.ad.nameFilter) : '',
    objAttributes: Array.isArray(cfg.ad.objAttributes) ? cfg.ad.objAttributes.map(String) : [],
    rawAttributes: Array.isArray(cfg.ad.rawAttributes) ? cfg.ad.rawAttributes.map(String) : [],
    searchBase: cfg.ad.searchBase ? String(cfg.ad.searchBase) : '',
    searchFilter: cfg.ad.searchFilter ? String(cfg.ad.searchFilter) : '',
  });
  user.setLDAPClient(adClient);
  user.setServiceUrl(String(cfg.cas.service_base_url));
  user.setUserPhotoCacheRoot(String(cfg.userphotos.root) + '/');  // root must end in slash!
  user.setUserPhotoCacheMaxAge(Number(cfg.userphotos.maxAge));
  user.init(app);

  profile.init(app);

  // device(app);  // Provides devices from external service (ie CCDB)

  doc.init(app);

  app.use(api.getRouter());

  // no handler found for request (404)
  app.use(handlers.notFoundHandler());

  // error handlers
  app.use(handlers.requestErrorHandler());

  info('Application started');
  return app;
}

// asynchronously stop the application
export function stop(): Promise<void> {
  return task.stop();
}

// asynchronously disconnect the application
async function doStop(): Promise<void> {
  info('Application stopping');

  if (activeResponses.size > 0) {
    info('Wait for %s active response(s)', activeResponses.size);
    try {
      await Promise.race([activeFinished, promises.rejectTimeout(15000)]);
    } catch (err) {
      warn('Timeout: End %s active response(s)', activeResponses.size);
      for (const res of activeResponses) {
        res.end();
      }
    }
  }

  if (activeSockets.size > 0) {
    warn('Destroy %s active socket(s)', activeSockets.size);
    for (const soc of activeSockets) {
      soc.destroy();
    }
  }

  // Unbind AD Client
  if (adClient) {
    try {
      await adClient.unbind();
      adClient.destroy();
      info('LDAP client connection destroyed');
    } catch (err) {
      warn('LDAP client connection unbind failure: %s', err);
    }
  }

  // disconnect Mongoose (MongoDB)
  try {
    await mongoose.disconnect();
    info('Mongoose disconnected');
  } catch (err) {
    warn('Mongoose disconnect failure: %s', err);
  }

  try {
    await status.monitor.stop();
    info('Status monitor stopped');
  } catch (err) {
    warn('Status monitor stop failure: %s', err);
  }

  info('Application stopped');
}
