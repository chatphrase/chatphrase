//from adapter.js
/*global RTCPeerConnection getUserMedia attachMediaStream
  reattachMediaStream webrtcDetectedBrowser webrtcDetectedVersion */
  
"use strict";

//Function to create slug for a phrase.
function slugify(phrase) {
  return phrase.toLowerCase()
    .replace(/\&/g,' and ')
    .replace(/\%/g,' percent ')
    .replace(/[^ \-\w]/g,'')
    .replace(/[ \-]+/g,' ')
    .trim()
    .replace(/ /g,'-');
}

//Semaphore that we're adjusting the location, so that we don't fall into an
//endless loop of reacting to our own updates
var changingLocation = false;

function changeLocation(path) {
  //Set the semaphore so this change won't be read
  changingLocation = true;

  //Set the URL fragment (location.hash) to the one we just constructed.
  location.hash = '#/'+path;
}

// Do hashslash location.
function updateFromHash() {

  //If we have just set the hash ourselves
  if(changingLocation){

    //Go back to listening for the next situation where the hash changes
    changingLocation = false;

  //If the hash has changed by external forces
  } else {

    //If the URL has a hash component and the second character is '/'
    //(a hashslash, so we distinguish from in-page anchoring)
    if (location.hash && location.hash.substr(1,1) == '/'){
      
    //If the URL has no hash component, or it has some meaningless
    //non-hashslash value
    } else {

      //Reset to the initial state
    }
  }
}

//Parse/set the initial load hash value
updateFromHash();
//Set a listener so we update the logo every time the URL hash changes
//(like when the user presses the Back button)
window.onhashchange = updateFromHash;

function pollRing(phrase,body){

}

function answerRing(phrase,body){

}

function startRinging(phrase,stream){
  //Crete a peer connection that will use Google's STUN server
  var peercon = new RTCPeerConnection({
    "iceServers": [{"url": "stun:stun.l.google.com:19302"}]});
    
  var firstRing = new XMLHttpRequest();
   firstRing.onreadystatechange = function () {
        function ringFromDesc(desc){
          pollRing(phrase,JSON.stringify({ "session": desc }));
        }
        
        if (firstRing.readyState == 4) {
          //parse response
          var resbody = JSON.parse(firstRing.responseText);
          
          if(resbody.waiting){
            peercon.createAnswer(resbody.waiting,ringFromDesc);
          } else {
            peercon.createOffer(ringFromDesc);
          }
        }
    };
  firstRing.open("GET","/api/ring/"+phrase);
  firstRing.setRequestHeader(
    "Content-type", "application/json; charset=utf-8");
  firstRing.send();  
}

function beginPhrase(phrase) {
  getUserMedia({audio:true,video:true},function(err){
    //tell the user they need to approve media capture to use chatphrase
  },function(stream){
    attachMediaStream(document.getElementById('pip'),stream);
    //advance to lobby / connection
  });
  
  //switch to limbo until media is successfully gotten
}
