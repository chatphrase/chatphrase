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

  var subscriptionCbs = Object.create(null);
  
  function subscribe(channel, listener, cb) {
    subscriptionCbs[channel] = listener;
    dbSubscriber.subscribe(channel,cb);
  }
  
  function unsubscribe(channel, cb) {
    dbSubscriber.unsubscribe(channel,cb);
    delete subscriptionCbs[channel];
  }
  
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
    db.multi()
      .get('waiting/'+req.params.slug)
      .lrange('ice/waiter/'+req.params.slug, 0, -1)
      .exec(function(err,reply){
        if(err) return next(err);

        if(reply[0]) {
          return res.send({waiting: JSON.parse(reply[0]),
            ice: reply[1] ? reply[1].map(JSON.parse) : reply[1]});
        } else {
          return res.send({status:'ready'});
        }
      });
  });

  //Polling endpoint to offer a connection,
  //and to see if somebody has answered
  app.post('/api/ring/:slug', function(req, res, next){
    var channel = 'waiter/' + req.params.slug;

    var timer = setTimeout(function(){

      // stop listening for answers
      //(until the next poll when we'll listen again)
      unsubscribe(channel,function(err) {
        if (err) return next(err);
        res.send({status:'waiting'});
      });
    }, POLL_WAIT_SECONDS * 1000);


    //if a message is recieved before the time is up,
    function answer(reply){
      db.lrange('ice/answerer/'+req.params.slug, 0, -1,
      function(err,ice) {
        //cancel the timeout
        clearTimeout(timer);

        if (err) return next(err);

        var multi = db.multi()
        .del('answered/' + req.params.slug)
        .del('ice/answerer/'+req.params.slug);
        
        queue()
        //delete the used answer line
        .defer(multi.exec.bind(multi))
        // stop listening for answers
        .defer(unsubscribe,channel)
        .await(function(err) {
          if (err) return next(err);

          //respond to the request
          res.send({answer: JSON.parse(reply),
            ice: ice ? ice.map(JSON.parse) : ice});
        });
      });
    }

    //check for an answer record (if the answer came between subscriptions)
    db.get('answered/' + req.params.slug, function(err, reply) {
      if (err) return next(err);
      if (reply) {
        answer(reply);
      } else { //if no answer record
        var multi = db.multi()
        //set a waiting record for any call that comes in before this request
        //is answered
        .setex('waiting/'+req.params.slug,
          POLL_WAIT_SECONDS + REQUEST_EXPIRE_SECONDS,
          JSON.stringify(req.body))
        //Refresh the ICE data to expire concurrent with the waiting record
        .expire('ice/waiter/'+req.params.slug,
          POLL_WAIT_SECONDS + REQUEST_EXPIRE_SECONDS);
        
        queue()
        .defer(multi.exec.bind(multi))
        .defer(subscribe,channel,answer)
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
    db.multi()
      .get('waiting/'+req.params.slug)
      .lrange('ice/waiter/'+req.params.slug,0,-1)
      .exec(handleDBResponse);

    function handleDBResponse(err, reply) {
      if (err) return next(err);
      //TODO: refactor to keep allowing calls after connection for ICE data,
      //for those scenarios where the waiter is still gathering their
      //ICE candidates after connection
      if (reply[0]) {
        db.multi()
          //send a message to calls ringing on this line
          .publish('waiter/'+req.params.slug,JSON.stringify(req.body))
          //set an "answer" record (with a short-ish TTL, for bogus answers)
          .setex('answered/'+req.params.slug,
            POLL_WAIT_SECONDS + REQUEST_EXPIRE_SECONDS,
            JSON.stringify(req.body))
          //Refresh the ICE data to expire concurrent with the answer
          .expire('ice/answerer/'+req.params.slug,
            POLL_WAIT_SECONDS + REQUEST_EXPIRE_SECONDS)
          //clear the waiting record and ICE data
          .del('waiting/'+req.params.slug)
          .del('ice/waiter/'+req.params.slug)
          .exec(function(err){
            if (err) return next(err);
            res.send({status:'answered',
              ice: reply[1] ? reply[1].map(JSON.parse) : reply[1]});
          });
      }
      //if there was no waiting record (say, perhaps, somebody already
      //answered and cleared it)
      else {
        res.send({status:'absent'});
      }
    }
  });

  //Endpoint to add ICE data
  app.post('/api/ice/:slug', function(req, res, next) {
    //NOTE: This is maybe a bit more labyrinthine than it should be
    var multi = db.multi()
      .rpush('ice/'+req.body.party+'/'+req.params.slug,
        JSON.stringify(req.body.ic))
      .expire('ice/'+req.body.party+'/'+req.params.slug,
        POLL_WAIT_SECONDS + REQUEST_EXPIRE_SECONDS);
       
    //TODO: Make this symmetrical
    if(req.body.party == "answerer")
      multi.publish("waiter/"+req.params.slug,null);
    
    multi.exec(function(err){
        if(err) return next(err);
        res.send({status:'noted'});
      });
  });
  
  // Endpoint to, at some more thoroughly stateful point in the future,
  // clear the channel for the next two endpoints that want to use it
  /*
  app.post('/api/connected/:slug', function(req, res, next) {
    var otherparty = req.body.party == "answerer" ? "waiting" : "answerer";
    
    //NOTE: This is maybe a bit more labyrinthine than it should be
    db.multi()
      .rpush('ice/'+req.body.party+'/'+req.params.slug,
        JSON.stringify(req.body.ic))
      .expire('ice/'+req.body.party+'/'+req.params.slug,
        POLL_WAIT_SECONDS + REQUEST_EXPIRE_SECONDS)
      .exec(function(err){
        if(err) return next(err);
        res.send({status:'noted'});
      });
  });*/

  return app;
};
