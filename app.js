var express = require('express');
var caress = require('caress');

module.exports = function appctor(cfg) {
  var app = express();

  app.set('views', __dirname + '/views');
  app.set('view engine', 'jade');

  app.use(require('nowww')());

  app.use(express.static(__dirname+'/static'));
  app.use('/signal', caress({redis: cfg.redis}));

  app.get('/', function(req,res) {
    res.render('index.jade');
  });

  return app;
};
