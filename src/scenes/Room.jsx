import React, { useCallback, useEffect, useRef, useState } from 'react'
import useSocket from '../providers/Socket'
// import usePeer from '../providers/Peer';
import { useNavigate } from 'react-router-dom';
import 'react-toastify/dist/ReactToastify.css';
import { OnlineUserList } from '../components/OnlineUserList';
import { User } from 'react-feather';
import audio from '../assets/ringtone.mp3';
import callertone from '../assets/callertone.mp3';
import { cn } from "../lib/utils";
import { DotPattern } from "../components/ui/dot-pattern";
import { toast } from "sonner"
import { LogOutIcon } from 'lucide-react';
import Call from '../components/Call';


class WebRTCConnection {
  constructor() {
    this.peer = this.initializePeerConnection();
  }

  initializePeerConnection() {
    const peer = new RTCPeerConnection({
      iceServers: [
        {
          urls: [
            "stun:stun.l.google.com:19302",
            "stun:global.stun.twilio.com:3478",
          ],
        },
      ],
    });

    // Listen for ICE candidates
    // peer.onicecandidate = (event) => {
    //   if (event.candidate) {
    //     console.log("New ICE candidate:", event.candidate);
    //     // Send the ICE candidate to the remote peer
    //   }
    // };

    // Listen for remote tracks added to the connection
    peer.ontrack = (event) => {
      console.log("Received remote stream:", event.streams[0]);
      if (this.onRemoteStream) {
        // Call the callback function to handle the remote stream
        this.onRemoteStream(event.streams[0]);
      }
    };

    return peer;
  }

  async createOffer() {
    const offer = await this.peer.createOffer();
    await this.peer.setLocalDescription(offer);
    return offer;
  }

  async createAnswer(offer) {
    await this.peer.setRemoteDescription(offer);
    const answer = await this.peer.createAnswer();
    await this.peer.setLocalDescription(answer);
    return answer;
  }

  addLocalStream(localStream) {
    localStream.getTracks().forEach((track) => {
      this.peer.addTrack(track, localStream);
    });
  }

  setRemoteDescription(description) {
    this.peer.setRemoteDescription(description);
  }

  closeConnection() {
    this.peer.close();
  }

  onRemoteStream(callback) {
    this.onRemoteStream = callback;
  }
}

export const Room = () => {
  const navigate = useNavigate();
  const { socket, onlineUsers, user, setUser } = useSocket();
  useEffect(() => {
    if(!user) navigate('/');
    const handleUnload = () => {
      if(connected) handleEndCall();
      window.addEventListener("onunload", handleUnload);
    }
  }, [])

  // useEffect(() => {
  //   if(!(localStorage.getItem('name') && socket)) navigate('/');
  // }, [])

  const webRTCConnectionRef = useRef(null);
  const audioRef = useRef(new Audio(callertone)); // Create the audio element here
  const [remoteStream, setRemoteStream] = useState(null);
  const [myStream, setMyStream] = useState(null);
  const [connected, setConnected] = useState(false);
  const [connectedUser, setConnectedUser] = useState({});
  const [calling, setCalling] = useState(false);

  const initializeConnection = (async () => {
    webRTCConnectionRef.current = new WebRTCConnection();
    console.log(webRTCConnectionRef.current)
    webRTCConnectionRef.current.onRemoteStream((stream) => {
      console.log("Handling received remote stream");
      setRemoteStream(stream);
    });

    const setupMediaStream = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: true, 
          audio: true 
        });
        setMyStream(stream)
        webRTCConnectionRef.current.addLocalStream(stream);
      } catch (error) {
        console.error('Error accessing media devices:', error);
      }
    };

    await setupMediaStream();
  })

  const handleCallUser = useCallback(async (user) => {
    endConnection()
    await initializeConnection();

    if (!webRTCConnectionRef.current) {
      console.error("WebRTC connection is not initialized yet.");
      return;
    }
    setCalling(user);
    audioRef.current?.play();
    await webRTCConnectionRef.current.createOffer();
    await new Promise(resolve => setTimeout(resolve, 1000));
    socket.emit('call_user', { to: user.id, offer: webRTCConnectionRef.current.peer.localDescription });
  }, [socket, initializeConnection]);

  const handleIncomingCall = useCallback(async ({ from, offer }) => {
    await initializeConnection();
    const aud = new Audio(audio)
    await aud.play();
    // if(connected) rejected();
    const accepted = async () => {
      const user = onlineUsers.find(user => user.id === from);
      setConnectedUser(user);
      setConnected(true);
      const ans = await webRTCConnectionRef.current.createAnswer(offer);
      socket.emit('call_accepted', { to: from, ans});
      aud.pause()
    }
    const rejected = () => {
      socket.emit('call_rejected', { to: from});
      aud.pause()
      console.log("rejected")
      endConnection()
    }
    toast("Incoming Call", {
      description: `Call from ${onlineUsers.find(user => user.id === from)?.name}`,
      action: {
        label: "Accept",
        onClick: () => accepted(),
      },
      closeButton: true,
      onDismiss: () => rejected(),
      onAutoClose: () => rejected(),
      classNames: {
        toast: 'bg-white',
        title: '',
        actionButton: 'bg-red-500 hover:bg-red-400 text-white py-1 px-3 rounded',
        cancelButton: 'cursor-pointer bg-white',
        closeButton: 'cursor-pointer bg-white',
      },
      duration: 11000
    });
  }, [socket, initializeConnection]);

  const handleCallAccepted = async ({ from, ans }) => {
    await webRTCConnectionRef.current.peer.setRemoteDescription(ans);
    console.log('Call got accepted');
    audioRef.current.pause();
    setConnected(true)
    const user = onlineUsers.find(user => user.id === from);
    setConnectedUser(user);
    setCalling(null);
  }

  const handleEndCall = () => {
    socket.emit('end_call', {to: connectedUser.id});
    endConnection();
  }

  const endConnection = useCallback(() => {
    setConnected(false);
    setRemoteStream(null);
    audioRef.current.pause();
    setCalling(null);

    if (myStream) {myStream.getTracks().forEach((track) => {
        track.stop();
        myStream.removeTrack(track);
      });
      setMyStream(null);
    }

    if (webRTCConnectionRef.current && webRTCConnectionRef.current.peer) {
      const pc = webRTCConnectionRef.current.peer;
      console.log(webRTCConnectionRef.current)

      // pc.getDataChannels().forEach(channel => channel.close());
      // pc.getSenders().forEach((sender) => pc.removeTrack(sender));
      pc.close();

      webRTCConnectionRef.current.peer = null;

      // // Log the final states
      // console.log('Final ICE Connection State:', pc.iceConnectionState);
      // console.log('Final Connection State:', pc.connectionState);
      // console.log('Final Signaling State:', pc.signalingState);

      // Force state changes if necessary
      if (pc.iceConnectionState !== 'closed') {
        pc.oniceconnectionstatechange = () => {
          console.log('ICE Connection State forced to close');
        };
        pc.setConfiguration(pc.getConfiguration());
      }

      if (pc.signalingState !== 'closed') {
        pc.onsignalingstatechange = () => {
          console.log('Signaling State forced to close');
        };
        pc.setLocalDescription({type: 'rollback'}).catch(console.error);
      }
    }

    // Nullify the WebRTCConnection instance
    webRTCConnectionRef.current = null;

    // Reset connected user state
    setConnectedUser({});

    // Optional: Check and release media devices
    navigator.mediaDevices.enumerateDevices()
      .then((devices) => {
        devices.forEach((device) => {
          if (device.kind === 'videoinput' || device.kind === 'audioinput') {
            console.log(`Device ${device.label} status checked`);
          }
        });
      })
      .catch(err => console.error('Error enumerating devices:', err));

    console.log('Connection ended and all resources cleared');
  }, [myStream]);


  const handleCallEnded = () => {
    toast.info('Call Ended', { closeButton: true });
    endConnection();  
  }

  const handleDeclinedOrNoResponse = () => {
    toast.error(`${calling?.name} has declined you call`, {
      description: "Please try again later",
      closeButton: true,
    })
    endConnection();
  }
  const handleLogout = () => {
    setUser(null)
    endConnection(); 
    navigate('/');
  }


  useEffect(() => {
      socket.on('incomming_call', handleIncomingCall);
      socket.on('call_accepted', handleCallAccepted);
      socket.on('call_disconnected', handleCallEnded);
      socket.on('call_rejected', handleDeclinedOrNoResponse);

      return () => {
        socket.off('incomming_call', handleIncomingCall);
        socket.off('call_accepted', handleCallAccepted);        
        socket.off('call_disconnected', handleCallEnded); 
        socket.off('call_rejected', handleDeclinedOrNoResponse);
      }
    }, [socket, handleIncomingCall, handleCallAccepted, handleDeclinedOrNoResponse]);
  
  return (
      <div className="w-full min-h-screen">
        <nav className="w-full flex justify-between p-5 border-b border-gray-400 box-border">
          <span className="text-blue-500 text-2xl font-bold italic">Peer</span>
            <div className="flex items-center gap-2 p-1 border border-gray-400 rounded-md text-gray-600 text-xl font-normal">
              <User />{user?.name}
                <i onClick={handleLogout} className='cursor-pointer size-10 bg-black flex items-center justify-center rounded-md'>
              <LogOutIcon color='white'/>
              </i>

            </div>
        </nav>
        <section className="w-full">
          {
            !connected ? (
              <>
                <DotPattern
                  cr={1}
                  className={cn(
                    "[mask-image:radial-gradient(300px_circle_at_center,white,transparent)]",
                  )}
                />
                <div className="w-full min-h-[80vh] p-4 lg:p-16 flex flex-col lg:flex-row items-center justify-center gap-12">
                  <div className="lg:flex-[0_0_70%] lg:text-5xl text-2xl font-bold">Seamless Connections, Anytime, Anywhere! 🚀</div>
                  <div className="lg:flex-[0_0_30%]">
                    <OnlineUserList calling={calling} onlineUsers={onlineUsers} handleCallUser={handleCallUser} />
                  </div>
                </div>
              </>
            ) : <Call remoteStream={remoteStream} myStream={myStream} connectedUser={connectedUser} handleEndCall={handleEndCall} />
          }
        </section>
      </div>
  )
}
