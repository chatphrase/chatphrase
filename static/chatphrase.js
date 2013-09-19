//from adapter.js
/*global RTCPeerConnection getUserMedia attachMediaStream
  reattachMediaStream webrtcDetectedBrowser webrtcDetectedVersion
  RTCSessionDescription RTCIceCandidate*/

"use strict";

// Create lowercase-and-hyphenated slug for a phrase.
function slugify(phrase) {
  return phrase.toLowerCase()
    .replace(/\&/g,' and ')
    .replace(/\%/g,' percent ')
    .replace(/[^ \-\w]/g,'')
    .replace(/[ \-]+/g,' ')
    .trim()
    .replace(/ /g,'-');
}

// Switch which "page" element is currently visible.
function switchState(stateName) {
  var states = document.querySelectorAll(".page.active");
  for (var i = 0; i < states.length; i++) {
    states[i].classList.remove('active');
    states[i].classList.add('inactive');
  }

  var newactive = document.getElementById(stateName);
  newactive.classList.remove('inactive');
  newactive.classList.add('active');
}

//TODO: general XHR function, with timeout CB

var consoleError = console.error.bind(console);

function pollRing(phrase,body,peercon){
  var pollRq = new XMLHttpRequest();
   pollRq.onreadystatechange = function () {
      if (pollRq.readyState == 4) {
        // parse response
        var resbody = JSON.parse(pollRq.responseText);

        if (resbody.answer) {
          // connect to the answer
          peercon.setRemoteDescription(
            new RTCSessionDescription(resbody.answer),
            function(){
              console.log('connected to',resbody.answer);
            },consoleError);
        }
        
        // For a second let's make-believe there can never be ICE
        // before we've received the session description
        addIce(peercon,resbody.ice);
        
        // Keep ringing and gathering ICE candidates until the
        // remote stream handler aborts the running poll
        return pollRing(phrase, body, peercon);
      }
    };
  pollRq.open("POST","/api/ring/"+phrase);
  pollRq.setRequestHeader(
    "Content-type", "application/json; charset=utf-8");
    
  //allow the remote stream handler to terminate this
  enormousHackToStopPolling = pollRq;
  pollRq.send(body);
}

function answerRing(phrase,body,peercon){
  var answerRq = new XMLHttpRequest();
   answerRq.onreadystatechange = function () {
      function ringFromDesc (f) {
        return function (desc) {
          return f(phrase,JSON.stringify({ "session": desc }));
        };
      }

      if (answerRq.readyState == 4) {
        //parse response
        var resbody = JSON.parse(answerRq.responseText);

        if(resbody.status == "answered") {
          addIce(peercon,resbody.ice);
          //inform the user that they're waiting for the other end
          //to connect (if they haven't already)
          //TODO: continue polling for ICE until connected?
          //(final polls can terminate when the other end
          //acknowledges it's connected)
        } else {
          //go back to the beginning
          //TODO: destroy existing peer connection?
          beginPhrase(phrase);
        }
      }
    };
  answerRq.open("POST","/api/answer/"+phrase);
  answerRq.setRequestHeader(
    "Content-type", "application/json; charset=utf-8");
  answerRq.send(body);
}

//because keeping track of a proper polling state is just too hard
var enormousHackToStopPolling;

// This is also hacky, but this time it's not my fault
var persistentPeerConnectionReferenceToEvadeGarbageCollectionInChrome;

function onRemoteStreamConnected(evt){
  attachMediaStream(document.getElementById('vidscreen'),evt.stream);
}

// Constructs a function that posts ICE candidates.
function icePoster(phrase, party) {
  return function(evt) {
    // After all the ICE candidates have been worked over,
    // onicecandidate gets called with an event without a candidate.
    // Send that so the other end knows when to stop ICE polling.
    //if (evt.candidate) {
      var iceRq = new XMLHttpRequest();
       iceRq.onreadystatechange = function () {
          if (iceRq.readyState == 4) {
            //do nothing
          }
        };
      iceRq.open("POST","/api/ice/"+phrase);
      iceRq.setRequestHeader(
        "Content-type", "application/json; charset=utf-8");
      iceRq.send(JSON.stringify({party: party,
        ic: evt.candidate ? evt.candidate : null}));
    //}
  };
}

//Function to handle incoming ICE candidates.
function addIce(peercon, ice){
  function addCandidate(candidate) {
    peercon.addIceCandidate(candidate,
      function() {console.log('added',candidate)},
      function(err) {console.error(candidate,err)});
  }
  if (ice) {
    for (var i=0; i < ice.length; i++) {
      if(ice[i])
        addCandidate(new RTCIceCandidate(ice[i]));
      else if(enormousHackToStopPolling) {
        enormousHackToStopPolling.abort();
      }
    }
  }
}

function startRinging(phrase,stream){
  // Create a peer connection that will use
  // vline's STUN server, Google's STUN server,
  // and numb.viagenie.ca for TURN
  var peercon = new RTCPeerConnection({
    "iceServers": [
        {"url": "stun:stun.vline.com"}
        ,{"url": "stun:stun.l.google.com:19302"}
        ,{
            url: 'turn:@numb.viagenie.ca',
            username: 'ice@chatphrase.com',
            credential: 'yovipletskickit'
        }
      ]});

  persistentPeerConnectionReferenceToEvadeGarbageCollectionInChrome = peercon;

  //add our stream to the connection
  peercon.addStream(stream);

  //add a listener for the stream from the other end
  peercon.onaddstream = onRemoteStreamConnected;

  var firstRing = new XMLHttpRequest();
   firstRing.onreadystatechange = function () {
      function ringFromDesc (f) {
        return function (desc) {
          //TODO: I'm reading some stuff about how Opus should be listed
          //as preferred at this point?

          //I'm not completely sure I understand this line (we add the session
          //we just made as a "local description"? Uh... duh?)
          peercon.setLocalDescription(desc, null, consoleError);

          //Send this request to the other end
          return f(phrase,JSON.stringify(desc),peercon);
        };
      }

      if (firstRing.readyState == 4) {
        //parse response
        var resbody = JSON.parse(firstRing.responseText);

        //NOTE: Maybe we should hold off on creating the session offers
        //until there's two endpoints on the line
        peercon.onicecandidate = icePoster(phrase,
          resbody.waiting ? 'answerer' : 'waiter');
        if (resbody.waiting) {
          
          //add the remote session to the connection
          peercon.setRemoteDescription(
            new RTCSessionDescription(resbody.waiting),
            function(){
              console.log('connected to',resbody.waiting);
            }, consoleError);

          addIce(peercon,resbody.ice);

          peercon.createAnswer(ringFromDesc(answerRing));
        } else {
          peercon.createOffer(ringFromDesc(pollRing),consoleError,
            { 
              mandatory: {
                OfferToReceiveAudio: true,
                OfferToReceiveVideo: true,
                },
              optional: [
                { DtlsSrtpKeyAgreement: true },
                { IceRestart: true }
                ]
              });
        }
      }
    };
  firstRing.open("GET","/api/ring/"+phrase);
  firstRing.setRequestHeader(
    "Content-type", "application/json; charset=utf-8");
  firstRing.send();
}

function beginPhrase(phrase) {
  document.title = phrase.replace(/-/g,' ') + ' : Chatphrase';
  getUserMedia({audio:true,video:true},function(stream){
    attachMediaStream(document.getElementById('pip'),stream);
    //advance to lobby / connection
    startRinging(phrase,stream);
    switchState("room");
  },function(err){
    if(err.code && err.code == err.PERMISSION_DENIED
      || err.name == "PERMISSION_DENIED"
    ){
      document.getElementById('virgil').textContent =
        "It looks like we've been denied permission to access your camera. "+
        "We need access to your camera to start the call (it wouldn't be "+
        "much of a video call if we didn't). Please reset permissions for "+
        "camera access on chatphrase.com and refresh the page.";
    } else {
      document.getElementById('virgil').textContent =
        "Recieved error trying to getUserMedia: " + 
          (typeof err == "string" ? err : JSON.stringify(err)) ;
    }
  });

  //switch to limbo until media is successfully gotten
  switchState("limbo");
}

//Cheap submission function.
function goToPhrase(phrase) {
  location.hash = '#/'+ slugify(phrase);
}

// Phrase submit event listener is specified in the Jade for the page itself

// Do hashslash location.
function updateFromHash() {
  //If the URL has a hash component and the second character is '/'
  //(a hashslash, so we distinguish from in-page anchoring)
  if (location.hash && location.hash.substr(1,1) == '/'
    && location.hash.length > 2){
    beginPhrase(slugify(decodeURIComponent(location.hash.substr(2))));

  //If the URL has no hash component, or it has some meaningless
  //non-hashslash value
  } else {
    //Reset to the initial state
    document.title = 'Chatphrase';
    document.getElementById("phrase").value = "";
    switchState("landing");
  }
}

//Parse/set the initial load hash value
updateFromHash();
//Set a listener so we update the logo every time the URL hash changes
//(like when the user presses the Back button)
window.onhashchange = updateFromHash;
