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
function setMessageHTML(html) {
  document.getElementById('message').innerHTML = html;
}
function setErrorMessage(text, err) {
  var msgEl = document.getElementById('message');
  while (msgEl.firstChild) {
    msgEl.removeChild(msgEl.firstChild);
  }
  var p = document.createElement('p');
  p.textContent = text;
  msgEl.appendChild(p);
  var pre = document.createElement('pre');
  p.textContent = err.message || JSON.stringify(err);
  msgEl.appendChild(pre);
  var reportMe = document.createElement('p');
  reportMe.innerHTML = 'Try refreshing the page. ' +
    'If you keep getting this error, please report it at ' +
    '<a href="https://github.com/chatphrase/chatphrase/issues" target="_blank">' +
    'https://github.com/chatphrase/chatphrase/issues</a>.';
  msgEl.appendChild(reportMe);
  console.error(err);
}

function barkOnConnectionTimeout() {
  setMessageHTML("<h2>Hmm, it shouldn't be taking this long.</h2>"+
     "<p>You're probably encountering a browser bug that's " +
    'keeping the connection from working.</p><p>Go to ' +
    '<a href="https://github.com/chatphrase/chatphrase/wiki/Connection-failures" target="_blank">' +
    "https://github.com/chatphrase/chatphrase/wiki/Connection-failures</a> " +
    "and let's see what we can do about fixing this.</p>");
  document.getElementById('message').hidden = false;
  document.getElementById('vidscreen').hidden = true;
}

// Switch which "page" element is currently visible.
function switchState(stateId) {
  var states = document.getElementsByClassName("page");
  for (var i = 0; i < states.length; i++) {
    states[i].hidden = !(states[i].id == stateId);
  }
}

var signal;
var connectingWatchdog;
var connected;
var sigHooks = {
  error: function (err) {
    setErrorMessage('Signaling error:',err);
    document.getElementById('message').hidden = false;
    document.getElementById('pip').hidden = true;
    document.getElementById('vidscreen').hidden = true;
  },
  remoteStream: function onRemoteStream(stream) {
    attachMediaStream(document.getElementById('vidscreen'),stream);
  },
  waiting: function setWaitingMessage() {
    setMessage("Waiting for other end to connect...");
  },
  connecting: function setConnectingMessage() {
    setMessage("Connecting to other end...");
    connectingWatchdog = setTimeout(barkOnConnectionTimeout,5000);
  },
  connected: function setConnectingMessage() {
    clearTimeout(connectingWatchdog);
    connected = true;
    setMessage("Connected");
    document.getElementById('message').hidden = true;
    document.getElementById('vidscreen').hidden = false;
  },
  remoteSignalLost: function restartIfNotConnected() {
    // If we never received the remote stream
    if (!connected) {
      // Restart signaling
      // TODO: revert message state
      setMessage("Reconnecting to Chatphrase...");
      signal.start();
    }
  }
};

function beginPhrase(phrase) {
  // Ready the signaling state
  signal = chatphraseSignaling(phrase,sigHooks);

  // Update the window title
  document.title = phrase.replace(/-/g, ' ') + ' : Chatphrase';

  // Attempt to acquire the user's camera
  getUserMedia({audio:true,video:true},
    gumSuccess, gumError);

  function gumSuccess(stream) {
    // Display the local video feed in a picture-in-picture element
    attachMediaStream(document.getElementById('pip'), stream);

    document.getElementById('pip').hidden = false;

    // Begin connecting / waiting
    setMessage("Connecting to Chatphrase...");
    signal.start(stream);
  }

  function gumError(err) {
    if(err.code && err.code == err.PERMISSION_DENIED
      || err.name == "PERMISSION_DENIED"
      || err == "PERMISSION_DENIED" // Firefox spits a string
    ){
      setMessageHTML(
        "<h2>Permission to use your camera and microphone has been denied.</h2>"+
        "<p>If you did not choose to deny permission, check that another "+
        "program isn't using the camera and/or microphone.</p>"+
        "<p>If you <em>did</em> choose to deny permission, you'll need to "+
        "allow camera and microphone access on chatphrase.com.</p>"+
        "<p>Once your camera and microphone are ready, refresh the "+
        "page to retry the chat connection.</p>");
    } else {
      setErrorMessage("Error trying to getUserMedia:", err);
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
