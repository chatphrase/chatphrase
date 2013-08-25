var express = require('express');
var redis = require('redis');

module.exports = function appctor(cfg) {

  var db = redis.createClient(cfg.redis.port, cfg.redis.hostname,
    {no_ready_check: true});
  db.auth(cfg.redis.password);

  var app = express();
  
  app.set('views', __dirname + '/views');
  app.set('view engine', 'jade');
  
  app.use(express.static(__dirname+'/static'));
  
  app.get('/', function(req,res) {
    res.render('index.jade');
  });
  
  //Initial endpoint to check if there is an offer
  //waiting on the line
  app.get('/api/ring/:slug', function(req,res){
    //get the state of this phrase from the database
  });
  
  //Polling endpoint to offer a connection,
  //and to see if somebody has answered
  app.post('/api/ring/:slug', function(req,res){
    var responded = false;
    //check for an answer record (if the answer came between subscriptions)
    //if no answer record
    //subscribe to messages for this line
    
    //wait the poll duration for an answer
    setTimeout(function(){
      if(!responded) res.send({status:'wait'});
      //TODO: clear "ringing" record (after timeout)?
    },10000);
    
    //if a message is recieved before the time is up,
    //respond to the request and cancel the timeout
  });
  
  //Endpoint to answer a waiting call
  app.post('/api/answer/:slug', function(req,res){
    //send a message to calls ringing on this line
    //set an "answer" record (with a short TTL, for bogus answers)
  });
    
  return app;
};
