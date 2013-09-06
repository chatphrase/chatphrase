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

function changeLocation(path) {
  //Set the URL fragment (location.hash) to the one we just constructed.
  location.hash = '#/'+path;
}

//TODO: general XHR function, with timeout CB

function pollRing(phrase,body,peercon){
  var pollRq = new XMLHttpRequest();
   pollRq.onreadystatechange = function () {
      if (pollRq.readyState == 4) {
        // parse response
        var resbody = JSON.parse(pollRq.responseText);
        
        if (resbody.answer) {
          // connect to the answer
          peercon.setRemoteDescription(
            new RTCSessionDescription(resbody.answer));
        } else {
          // Keep ringing
          return pollRing(phrase, body, peercon);
        }
      }
    };
  pollRq.open("POST","/api/ring/"+phrase);
  pollRq.setRequestHeader(
    "Content-type", "application/json; charset=utf-8");
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
          //inform the user that they're waiting for the other end
          //to connect (if they haven't already)
          //TODO: continue polling for ICE negotiation
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

function onRemoteStreamConnected(evt){
  attachMediaStream(document.getElementById('vidscreen'),evt.stream);
    
  //Do other "on remote client connected" stuff
}

function startRinging(phrase,stream){
  //Crete a peer connection that will use Google's STUN server
  var peercon = new RTCPeerConnection({
    "iceServers": [{"url": "stun:stun.l.google.com:19302"}]});
  
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
          peercon.setLocalDescription(desc);
          
          //Send this request to the other end
          return f(phrase,JSON.stringify({ "session": desc }),peercon);
        };
      }
      
      if (firstRing.readyState == 4) {
        //parse response
        var resbody = JSON.parse(firstRing.responseText);
        
        //NOTE: Maybe we should hold off on creating the session offers
        //until there's two endpoints on the line
        if (resbody.waiting) {
          peercon.createAnswer(resbody.waiting,ringFromDesc(answerRing));
        } else {
          peercon.createOffer(ringFromDesc(pollRing));
        }
      }
    };
  firstRing.open("GET","/api/ring/"+phrase);
  firstRing.setRequestHeader(
    "Content-type", "application/json; charset=utf-8");
  firstRing.send();  
}

function beginPhrase(phrase) {
  getUserMedia({audio:true,video:true},function(stream){
    attachMediaStream(document.getElementById('pip'),stream);
    //advance to lobby / connection
    startRinging(phrase,stream);
    switchState("room");
  },function(err){
    if(err.code == err.PERMISSION_DENIED){
      document.getElementById('virgil').textContent =
        "It looks like we've been denied permission to access your camera. "+
        "We need access to your camera to start the call (it wouldn't be "+
        "much of a video call if we didn't). Please reset permissions for "+
        "camera access on chatphrase.com and refresh the page.";
    }
  });
  
  //switch to limbo until media is successfully gotten
  switchState("limbo");
}

//Cheap submission function.
function goToPhrase(phrase) {
  changeLocation(slugify(phrase));
}

// Event listener is specified in the Jade for the page itself


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
    document.getElementById("phrase").value = "";
    switchState("landing");
  }
}

//Parse/set the initial load hash value
updateFromHash();
//Set a listener so we update the logo every time the URL hash changes
//(like when the user presses the Back button)
window.onhashchange = updateFromHash;
