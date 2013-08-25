var cfg = require("envigor")();
var app = require('./app.js')(cfg);
var server = require('http').createServer(app);

server.listen(cfg.port);
