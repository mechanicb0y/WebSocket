import { useEffect, useState, useRef } from 'react' // i added useRef but not used
import io from 'socket.io-client'
import './App.css'
import Input from './components/input';

function App() {
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [serverResponse, setServerResponse] = useState('');
  //i also added these states but not used
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [videoName, setVideoName] = useState('');
  const [showSelectedInfo, setShowSelectedInfo] = useState(false);
  const fileInputRef = useRef(null);

  // helper: format bytes to human readable string
  const formatBytes = (bytes) => {
    if (typeof bytes !== 'number') return '';
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  useEffect(() => {

    const newSocket = io('http://localhost:3000');
    setSocket(newSocket);


    newSocket.on('connect', () => {
      console.log('Connected to server:', newSocket.id);
      setIsConnected(true);
    });

    newSocket.on('disconnect', () => {
      console.log('Disconnected from server');
      setIsConnected(false);
    });


    newSocket.on('test response', (data) => {
      console.log('📨 Response from server:', data);
      setServerResponse(data);
    });

    //receive video confirmation from server
    newSocket.on('video-received', (data) => {
      console.log('Video sent to server:', data);
      // use the name sent by the server to avoid stale closures
      setServerResponse(`✅ Video "${data.name}" sent to mobile!`);
    });

    // optional: show server inactive messages if server emits them
    newSocket.on('server inactive', (msg) => {
      console.log('Server inactive:', msg);
      setServerResponse(msg);
    });

    return () => {
      newSocket.disconnect();
    };
  }, []);


  useEffect(() => {
    if (!serverResponse) return;
    const timer = setTimeout(() => {
      setServerResponse('');
    }, 3000);
    return () => clearTimeout(timer);
  }, [serverResponse]);

  // auto-hide selected video info after 3 seconds (does not clear selection)
  useEffect(() => {
    if (!selectedVideo) return;
    setShowSelectedInfo(true);
    const t = setTimeout(() => setShowSelectedInfo(false), 10000); // show for 10s
    return () => clearTimeout(t);
  }, [selectedVideo]);


  // to handle file selection
  const handleFileSelect = (event) => {
    const file = event.target.files[0];
    if (file) {
      if (file.type.startsWith('video/')) {
        setSelectedVideo(file);
        setVideoName(file.name);
        setServerResponse(`Selected: ${file.name} (${(file.size / 1024).toFixed(0)} KB)`);
        setShowSelectedInfo(true);
        // reset input so selecting the same file again triggers onChange
        if (fileInputRef?.current) fileInputRef.current.value = '';
      } else {
        alert('Please select a video file');
      }
    }
  };


  // send video to mobile
  const sendVideoToMobile = () => {
    if (!socket || !selectedVideo) {
      alert('Please select a video file first!');
      return;
    }

    const reader = new FileReader();
    reader.onload = function (e) {
      // send video data to server
      socket.emit('send-video', {
        name: selectedVideo.name,
        size: selectedVideo.size,
        type: selectedVideo.type,
        // just sending a snippet of the data for demo purposes
        data: e.target.result.substring(0, 500) + '...'
      });

      setServerResponse(`Sending "${selectedVideo.name}" to mobile...`);
    };
    reader.readAsDataURL(selectedVideo);
  };


  // button to open file picker
  const openFilePicker = () => {
    fileInputRef.current.click();
  };


  return (
    <>
      <h1>React Multiplayer Dashboard</h1>
      <Input placeholder="Enter your name" />

      {/* button to open file picker */}
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        accept="video/*"
        onChange={handleFileSelect}
      />

      {/* button to choose video file */}
      <button onClick={openFilePicker} style={{ margin: '10px' }}>
        📁 Choose Video File
      </button>

      {/* display selected video info */}
      {selectedVideo && (
        <div className={`selected-video ${!showSelectedInfo ? 'hidden' : ''}`} style={{ margin: '15px', padding: '10px', borderRadius: '5px' }}>
          <p>📹 <strong>{selectedVideo.name}</strong></p>
          <p>📏 Size: {formatBytes(selectedVideo.size)} ({Math.round(selectedVideo.size / 1024)} KB)</p>
          <p>🗂️ Format: {selectedVideo.type || (selectedVideo.name.split('.').pop() || 'unknown')}</p>
          <p>🕒 Last modified: {selectedVideo.lastModified ? new Date(selectedVideo.lastModified).toLocaleString() : 'N/A'}</p>
        </div>
      )}

      {/* send video to mobile */}
      {selectedVideo && (
        <button
          onClick={sendVideoToMobile}
          style={{ margin: '10px', background: '#4CAF50', color: 'white' }}
          disabled={!isConnected}
        >
          📱 Send Video to Mobile
        </button>
      )}


      <button onClick={() => {
        if (socket) {
          socket.emit('test', 'test msg from web');
          alert('message sent');
        }
      }}>
        Send Test Message
      </button>

      <p> Connection: {isConnected ? ' Connected' : ' Disconnected'}</p>
      <p> Socket ID: {socket?.id || 'Not connected'}</p>


      {serverResponse && (
        <div className="response-box">
          <h3> Server Response:</h3>
          <p>{serverResponse}</p>
          <p><small>Time: {new Date().toLocaleTimeString()}</small></p>
        </div>
      )}
    </>
  );
}

export default App;