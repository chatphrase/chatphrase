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

function returnToLanding() {
  //TODO: kill the current connection state
  document.title = 'Chatphrase';
  document.getElementById("phrase").value = "";
  document.getElementById('message').textContent = "";
  switchState("landing");
}

function resetPageState() {
  document.getElementById("phrase").value = "";
  returnToLanding();
}

//because keeping track of a proper polling state is just too hard
var enormousHackToStopPolling;

// This is also hacky, but this time it's not my fault
var persistentPeerConnectionReferenceToEvadeGarbageCollectionInChrome;

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

// Constructor for function that adds candidates to a peer connection.
// Useful for passing to the candidate queue's forEach.
function candidateAdder(peercon) {
  return function (candidate) {
    peercon.addIceCandidate(candidate,
      function() {console.log('added',candidate)},
      function(err) {console.error(candidate,err)});
  };
}

//Another hack, to not add ICE until the remote session has been set.
var remoteIceQueue = [];

function clearRemoteIceQueue(peercon) {
  remoteIceQueue.forEach(candidateAdder(peercon));
  remoteIceQueue = null;
}

//Function to handle incoming ICE candidates.
function addIce(peercon, ice) {

  // Add a candidate to the peercon, or queue it if we're queuing ICE
  // candidates right now (because we haven't set the remote session
  // description yet)
  function addCandidate(candidate) {
    if (remoteIceQueue) remoteIceQueue.push(candidate);
    else candidateAdder(peercon)(candidate);
  }

  // Only some signals come with ICE, but we call this function on all signals.
  if (ice) {
    for (var i=0; i < ice.length; i++) {
      if(ice[i])
        addCandidate(new RTCIceCandidate(ice[i]));
      // If there's a null in the ICE candidate array, there won't be any more
      // candidates and we should stop polling for them.
      else if(enormousHackToStopPolling) {
        enormousHackToStopPolling.abort();
      }
    }
  }
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

function onRemoteStreamConnected(evt){
  document.getElementById('message').textContent = "";
  attachMediaStream(document.getElementById('vidscreen'),evt.stream);
}

//TODO: general XHR function, with timeout CB

var consoleError = console.error.bind(console);

function pollRing(phrase,body,peercon) {
  document.getElementById('message').textContent = "Waiting...";
  var pollRq = new XMLHttpRequest();
   pollRq.onreadystatechange = function () {
      if (pollRq.readyState == 4) {
        // parse response
        var resbody = JSON.parse(pollRq.responseText);

        // Add or queue the ICE for the remote description
        addIce(peercon,resbody.ice);

        //If we have the remote answerer's session description
        if (resbody.answer) {
          // connect to the answer
          document.getElementById('message').textContent = "Connecting...";

          peercon.setRemoteDescription(
            new RTCSessionDescription(resbody.answer),
            function(){
              console.log('connected to',resbody.answer);
            },consoleError);

          //stop queuing now that we've set the remote description
          clearRemoteIceQueue(peercon);
        }

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

function answerRing(phrase,body,peercon) {
  document.getElementById('message').textContent = "Connecting...";
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

function startRinging(phrase,stream) {
  document.getElementById('message').textContent = "Creating connection...";
  // Create a peer connection that will use
  // vline's STUN server, Google's STUN server,
  // and numb.viagenie.ca for TURN
  var peercon = new RTCPeerConnection({
    "iceServers": [
        {"url": "stun:stun.vline.com"}
        ,{"url": "stun:stun.l.google.com:19302"}
        ,{
            url: 'turn:numb.viagenie.ca',
            username: 'ice@chatphrase.com',
            credential: 'yovipletskickit'
        }
      ]},

      // DTLS-SRTP is the future of WebRTC.
      // Versions of Chrome before 31 don't do DTLS-SRTP by default
      // (due to an inefficient certificate generation scheme or something),
      // so you need to explicitly request it to be able to interoperate
      // with other implementations (like Firefox).
      {optional:[{DtlsSrtpKeyAgreement: true}]});

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
          // as preferred at this point?

          //I get why WebRTC works like this now (we can generate session
          //descriptions that we don't actually end up using with no penalty).
          //arg 2 is a NOP because Firefox freaks out if it's null, and the
          //standard doesn't actually say it's optional.
          peercon.setLocalDescription(desc, function(){}, consoleError);

          //Send this request to the other end
          return f(phrase,JSON.stringify(desc),peercon);
        };
      }

      if (firstRing.readyState == 4) {
        //parse response
        var resbody = JSON.parse(firstRing.responseText);

        peercon.onicecandidate = icePoster(phrase,
          resbody.waiting ? 'answerer' : 'waiter');

        // If the signal from the initial request came back that there's
        // somebody waiting at this phrase
        if (resbody.waiting) {

          //add the remote session to the connection
          peercon.setRemoteDescription(
            new RTCSessionDescription(resbody.waiting),
            function(){
              console.log('connected to',resbody.waiting);
            }, consoleError);

          //Add any ICE candidates attached to this request
          addIce(peercon,resbody.ice);

          // Process the queue we just made
          clearRemoteIceQueue(peercon);

          //Send our answer to that waiting session
          peercon.createAnswer(ringFromDesc(answerRing));
        } else {
          peercon.createOffer(ringFromDesc(pollRing),consoleError,
            {
              mandatory: {
                OfferToReceiveAudio: true,
                OfferToReceiveVideo: true
                },
              optional: []
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
  },function(err){
    if(err.code && err.code == err.PERMISSION_DENIED
      || err.name == "PERMISSION_DENIED"
    ){
      document.getElementById('message').textContent =
        "It looks like we've been denied permission to access your camera. "+
        "We need access to your camera to start the call (it wouldn't be "+
        "much of a video call if we didn't). Please reset permissions for "+
        "camera access on chatphrase.com and refresh the page.";
    } else {
      document.getElementById('message').textContent =
        "Recieved error trying to getUserMedia: " +
          (typeof err == "string" ? err : JSON.stringify(err)) ;
    }
  });

  //switch to limbo until media is successfully gotten
  document.getElementById('message').textContent =
    "Chatphrase will begin connecting once you grant permission to use your "
    + "camera and microphone...";
  switchState("room");
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
    //Set things up so it's just like the page has been opened afresh
    resetPageState();
  }
}

//Parse/set the initial load hash value
updateFromHash();
//Set a listener so we update the logo every time the URL hash changes
//(like when the user presses the Back button)
window.onhashchange = updateFromHash;
