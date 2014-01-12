//from adapter.js
/*global RTCPeerConnection getUserMedia attachMediaStream
  reattachMediaStream webrtcDetectedBrowser webrtcDetectedVersion
  RTCSessionDescription RTCIceCandidate*/
//from signaling.js
/*global chatphraseSignaling*/
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
  setMessage("");
  switchState("landing");
}

function resetPageState() {
  document.getElementById("phrase").value = "";
  returnToLanding();
}

function setMessage(text) {
  document.getElementById('message').textContent = text;
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

var signal;
var connected;
var sigHooks = {
  error: function (err) {
    document.getElementById('vidscreen').hidden = true;
    setMessage('ERROR: ' + err.message);
    console.error(err);
  },
  remoteStream: function onRemoteStream(stream){
    setMessage("");
    attachMediaStream(document.getElementById('vidscreen'),stream);
    // TODO: implement a proper way of checking the ICE Agent connection state
    // especially since I think WebRTC implements a dummy / dud stream until
    // both ends are truly connected
    connected = stream;
  },
  remoteSignalLost: function restartIfNotConnected() {
    // If we never received the remote stream
    if (!connected) {
      // Restart signaling
      // TODO: revert message state
      signal.start();
    }
  }
};

function beginPhrase(phrase) {
  // Ready the signaling state
  signal = chatphraseSignaling(phrase,sigHooks);

  // Update the window title
  document.title = phrase.replace(/-/g,' ') + ' : Chatphrase';

  // Attempt to acquire the user's camera
  getUserMedia({audio:true,video:true},
    gumSuccess, gumError);

  function gumSuccess(stream) {
    // Display the local video feed in a picture-in-picture element
    attachMediaStream(document.getElementById('pip'),stream);

    // Begin connecting / waiting
    setMessage("Connecting to Chatphrase...");
    signal.start(stream);
  }

  function gumError(err) {
    if(err.code && err.code == err.PERMISSION_DENIED
      || err.name == "PERMISSION_DENIED"
    ){
      setMessage(
        "Permission to use your camera and microphone has been denied. "+
        "If you choose to deny permission, reset permissions for "+
        "camera and microphone access on chatphrase.com. "+
        "If you did not choose to deny permission, check that another "+
        "program isn't using the camera and/or microphone. "+
        "Once your camera and microphone are ready, refresh the "+
        "page to retry the chat connection.");
    } else {
      setMessage("Error trying to getUserMedia: " +
        (typeof err == "string" ? err : JSON.stringify(err))) ;
    }
  }

  // Inform the user what they need to do
  setMessage("Chatphrase will begin connecting once it is granted access "
    + "to use your camera and microphone...");

  // Enter the room state
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
