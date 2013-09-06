var express = require('express');
var redis = require('redis');
var queue = require("queue-async");

//While these should be properly configurable, I've yet to figure out
//how I want to do it, so...
var POLL_WAIT_SECONDS = 10;
var REQUEST_EXPIRE_SECONDS = 5;

module.exports = function appctor(cfg) {

  var db = redis.createClient(cfg.redis.port, cfg.redis.hostname,
    {no_ready_check: true});
  db.auth(cfg.redis.password);
  var dbSubscriber = redis.createClient(cfg.redis.port, cfg.redis.hostname,
    {no_ready_check: true});
  dbSubscriber.auth(cfg.redis.password);
  
  var dbSetex = db.setex.bind(db);
  var dbSubscribe = dbSubscriber.subscribe.bind(dbSubscriber);
  var dbUnsubscribe = dbSubscriber.unsubscribe.bind(dbSubscriber);
  
  
  var subscriptionCbs = Object.create(null);
  dbSubscriber.on("message",function(channel,message){
    if(subscriptionCbs[channel]) { //if not, I don't know, some problem
      subscriptionCbs[channel](message);
    }
  });

  var app = express();
  
  app.set('views', __dirname + '/views');
  app.set('view engine', 'jade');
  
  app.use(require('nowww')());
  
  app.use(express.json());

  app.use(express.static(__dirname+'/static'));
  
  app.get('/test', function(req,res) {
    res.render('index.jade');
  });

  //Initial endpoint to check if there is an offer
  //waiting on the line
  app.get('/api/ring/:slug', function(req,res,next){
    //get the state of this phrase from the database
    db.get('waiting/'+req.params.slug,function(err,reply){
      if(err) return next(err);
      if(reply) {
        return res.send({waiting:reply});
      } else {
        return res.send({status:'ready'});
      }
    });
  });
  
  //Polling endpoint to offer a connection,
  //and to see if somebody has answered
  app.post('/api/ring/:slug', function(req, res, next){
    function clearSubscription() {
      dbUnsubscribe(req.body.session);
      delete subscriptionCbs[req.body.session];
    }
    
    var timer = setTimeout(function(){
      res.send({status:'waiting'});
      clearSubscription();
    },POLL_WAIT_SECONDS*1000);
    
    
    //if a message is recieved before the time is up,
    function answer(reply){
      //respond to the request,
      res.send({answer:reply});
      //cancel the timeout,
      clearTimeout(timer);
      //and stop listening for answers
      clearSubscription();
      //no need to clear the answered record, we'll let the TTL handle that
    }
    
    //check for an answer record (if the answer came between subscriptions)
    db.get('answered/'+req.body.session,function(err,reply){
      if (err) return next(err);
      if (reply) {
        answer(reply);
      } else { //if no answer record
      
        //subscribe to messages for this line
        subscriptionCbs[req.body.session] = answer;
        
        //set a waiting record for any call that comes in before this request
        //is answered
        queue()
        .defer(dbSetex,'waiting/'+req.params.slug,req.body.session,
          POLL_WAIT_SECONDS + REQUEST_EXPIRE_SECONDS)
        .defer(dbSubscribe,req.body.session)
        .await(function(err){
          if (err) {
            //let's go ahead and clean up in the error case
            clearTimeout(timer);
            return next(err);
          }
        });
      }
    });
  });
  
  //Endpoint to answer a waiting call
  app.post('/api/answer/:slug', function(req, res, next) {
    //NOTE: This is maybe a bit more labyrinthine than it should be
    db.get('waiting/'+req.parms.slug,function(err, waiting_session) {
      if (err) return next(err);
      if (waiting_session) {
        //send a message to calls ringing on this line
        db.publish(waiting_session,req.body.session);
        //set an "answer" record (with a short-ish TTL, for bogus answers)
        db.setex('answered/'+waiting_session,req.body.session,
          POLL_WAIT_SECONDS + REQUEST_EXPIRE_SECONDS);
        //clear the waiting record
        db.del('waiting/'+req.parms.slug);
        res.send({status:'answered'});
      } 
      //if there was no waiting record (say, perhaps, somebody already
      //answered and cleared it)
      else { 
        res.send({status:'absent'});
      }
    });
  });
    
  return app;
};
