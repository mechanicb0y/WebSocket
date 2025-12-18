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
  const [isRegistered, setIsRegistered] = useState(false);
  // generate thumbnail from video file (returns dataURL)
  const generateThumbnail = (file) => {
    return new Promise((resolve, reject) => {
      try {
        const url = URL.createObjectURL(file);
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.src = url;
        video.muted = true;
        video.playsInline = true;
        video.addEventListener('loadeddata', () => {
          const time = Math.min(0.5, video.duration / 2 || 0);
          video.currentTime = time;
        });
        video.addEventListener('seeked', () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = Math.min(320, video.videoWidth);
            canvas.height = Math.min(180, video.videoHeight);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
            URL.revokeObjectURL(url);
            resolve(dataUrl);
          } catch (e) {
            URL.revokeObjectURL(url);
            reject(e);
          }
        });
        setTimeout(() => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = Math.min(320, video.videoWidth || 320);
            canvas.height = Math.min(180, video.videoHeight || 180);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
            URL.revokeObjectURL(url);
            resolve(dataUrl);
          } catch (e) {
            URL.revokeObjectURL(url);
            reject(e);
          }
        }, 3000);
      } catch (e) {
        reject(e);
      }
    });
  };

  // upload states
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadSpeed, setUploadSpeed] = useState('');
  const [uploadETA, setUploadETA] = useState('');
  const [uploadBytesSent, setUploadBytesSent] = useState(0);
  const [uploadId, setUploadId] = useState(null);
  const [targetId, setTargetId] = useState('');
  const [latestVideoUrl, setLatestVideoUrl] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [thumbnail, setThumbnail] = useState(null);
  const [uploadError, setUploadError] = useState(null);
  const [uploadBroadcast, setUploadBroadcast] = useState(false);
  const DEVICE_TYPE = 'android'; // restricted to Android phones only now

  // helper: format bytes to human readable string
  const formatBytes = (bytes) => {
    if (typeof bytes !== 'number') return '';
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const uploadIdRef = useRef(null);
  useEffect(() => { uploadIdRef.current = uploadId; }, [uploadId]);

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

    // upload-related events
    newSocket.on('upload-progress', (data) => {
      if (data && data.uploadId === uploadIdRef.current) {
        setUploadProgress(data.percent || 0);
      }
    });

    newSocket.on('upload-complete', (data) => {
      if (data && data.uploadId === uploadIdRef.current) {
        setServerResponse(`Upload complete: ${data.name}`);
        setUploadProgress(100);
        setUploading(false);
        setUploadSpeed('');
        setUploadETA('');
        if (data.url) setLatestVideoUrl(data.url);
      }
    });

    newSocket.on('upload-error', (err) => {
      console.error('Upload error from server', err);
      setServerResponse(`Upload error: ${err.message || 'unknown'}`);
      setUploading(false);
      setUploadError(err?.message || 'Upload failed');
    });

    newSocket.on('delivery-status', (status) => {
      if (status && status.uploadId === uploadIdRef.current) {
        if (status.delivered) {
          const recipients = status.recipients || (status.to && status.to !== 'broadcast' ? 1 : 0);
          setSuccessMessage(`Upload Complete! ${recipients} recipient${recipients !== 1 ? 's' : ''}`);
          // clear progress UI immediately
          setUploadProgress(100);
          setUploading(false);
          setUploadSpeed('');
          setUploadETA('');

          // show success message briefly then clear
          setTimeout(() => {
            setSuccessMessage('');
            setUploadProgress(0);
            setUploadId(null);
          }, 2000);
        } else {
          setServerResponse(`Delivery failed: ${status.reason}`);
          setUploading(false);
        }
      }
    });

    // when mobile receives video
    newSocket.on('mobile-video', (info) => {
      console.log('Mobile video message:', info);
      // show video URL and make it playable
      setServerResponse(`Video available: ${info.name}`);
      if (info.url) setLatestVideoUrl(info.url);
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

        // generate thumbnail preview (client-side)
        generateThumbnail(file).then(dataUrl => setThumbnail(dataUrl)).catch(() => setThumbnail(null));
      } else {
        alert('Please select a video file');
      }
    }
  };

  // chunked upload function (new) — keeps progress, speed and ETA
  const CHUNK_SIZE_LOCAL = 256 * 1024; // 256KB

  // pause/resume support
  const [isPaused, setIsPaused] = useState(false);
  const [isCanceled, setIsCanceled] = useState(false);
  const currentChunkRef = useRef(0);
  const totalChunksRef = useRef(0);

  const sendVideoToMobileChunked = async (broadcast = false) => {
    if (!socket || !selectedVideo) {
      alert('Please select a video file first!');
      return;
    }

    const totalSize = selectedVideo.size;
    const totalChunks = Math.ceil(totalSize / CHUNK_SIZE_LOCAL);
    totalChunksRef.current = totalChunks;

    // if resuming an existing upload, reuse uploadId and currentChunkRef; otherwise start fresh
    const isResume = !!uploadId;
    const id = isResume ? uploadId : `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    if (!isResume) setUploadId(id);
    if (!isResume) currentChunkRef.current = 0;

    setUploading(true);
    setUploadProgress(prev => (isResume ? prev : 0));
    setUploadBytesSent(prev => (isResume ? prev : 0));
    setUploadSpeed('');
    setUploadETA('');
    setIsPaused(false);
    setIsCanceled(false);
    setUploadError(null);
    setServerResponse(`Uploading "${selectedVideo.name}"...`);

    const startTime = Date.now() - (uploadBytesSent || 0) / (Math.max(1, parseFloat(uploadSpeed) || 1));

    // process remaining chunks starting from currentChunkRef.current
    for (let i = currentChunkRef.current; i < totalChunks; i++) {
      if (isCanceled) break;
      // pause loop when requested
      if (isPaused) {
        currentChunkRef.current = i; // remember where we stopped
        break;
      }

      const start = i * CHUNK_SIZE_LOCAL;
      const end = Math.min(totalSize, (i + 1) * CHUNK_SIZE_LOCAL);
      const chunkBlob = selectedVideo.slice(start, end);
      const arrayBuffer = await chunkBlob.arrayBuffer();

      // emit chunk with chunkSize so server can write at correct offset
      socket.emit('upload-chunk', {
        uploadId: id,
        name: selectedVideo.name,
        index: i,
        total: totalChunks,
        size: totalSize,
        targetId: broadcast ? null : (targetId || null),
        deviceType: DEVICE_TYPE,
        chunkSize: CHUNK_SIZE_LOCAL
      }, new Uint8Array(arrayBuffer));

      // update client-side progress counters
      setUploadBytesSent(prev => {
        const newSent = prev + (end - start);
        const percent = Math.min(100, Math.round((newSent / totalSize) * 100));
        setUploadProgress(percent);

        const elapsedSec = Math.max(0.001, (Date.now() - startTime) / 1000);
        const speed = newSent / elapsedSec; // bytes/sec
        setUploadSpeed(`${formatBytes(Math.round(speed))}/s`);
        const remaining = totalSize - newSent;
        const etaSec = speed > 0 ? Math.round(remaining / speed) : 0;
        setUploadETA(`${Math.floor(etaSec / 60)}m ${etaSec % 60}s`);

        return newSent;
      });

      currentChunkRef.current = i + 1;

      // small throttle to prevent starving event loop
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    // if we finished all chunks and not canceled, wait for server to emit upload-complete
    if (!isCanceled && currentChunkRef.current >= totalChunks) {
      // nothing else to do here — server will send completion/delivery-status
    } else if (isCanceled) {
      setUploading(false);
      setServerResponse('Upload canceled');
    }
  };

  // pause/resume controls
  const pauseUpload = () => { setIsPaused(true); };
  const resumeUpload = async () => {
    if (!uploadId) return;
    setIsPaused(false);
    // continue sending from current chunk
    await sendVideoToMobileChunked(uploadBroadcast);
  };
  const cancelUpload = () => { setIsCanceled(true); setIsPaused(false); };
  const retryUpload = async () => {
    // reset progress and start over
    setUploadError(null);
    currentChunkRef.current = 0;
    await sendVideoToMobileChunked(uploadBroadcast);
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

      {/* SENDER: upload controls */}
      <div className="role-section sender-section" style={{ marginTop: '12px', padding: '10px', borderRadius: 6 }}>
        <div className="role-badge">SENDER</div>

        {/* button to choose video file */}
        <div style={{ marginTop: '8px' }}>
          <button onClick={openFilePicker} style={{ margin: '6px' }} title="Select a video file to send">📁 Choose Video File</button>
        </div>

        {/* display selected video info */}
        {selectedVideo && (
          <div className={`selected-video ${!showSelectedInfo ? 'hidden' : ''}`} style={{ margin: '15px', padding: '10px', borderRadius: '5px', display: 'flex', gap: '12px', alignItems: 'center' }}>
            {thumbnail && <img src={thumbnail} alt="thumb" style={{ width: 120, height: 68, objectFit: 'cover', borderRadius: 6 }} />}
            <div style={{ textAlign: 'left' }}>
              <p>📹 <strong>{selectedVideo.name}</strong></p>
              <p>📏 Size: {formatBytes(selectedVideo.size)} ({Math.round(selectedVideo.size / 1024)} KB)</p>
              <p>🗂️ Format: {selectedVideo.type || (selectedVideo.name.split('.').pop() || 'unknown')}</p>
              <p>🕒 Last modified: {selectedVideo.lastModified ? new Date(selectedVideo.lastModified).toLocaleString() : 'N/A'}</p>
            </div>
          </div>
        )}

        {/* send video to mobile */}
        {selectedVideo && (
          <div style={{ marginTop: '10px' }}>
            <div style={{ marginBottom: '8px' }}>
              <label style={{ marginRight: '8px' }}>Target ID:</label>
              <input value={targetId} onChange={(e) => setTargetId(e.target.value)} placeholder="(optional) target client id" title="Enter recipient Socket ID (leave empty for broadcast)" />
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                className="send-btn"
                onClick={() => { setUploadBroadcast(false); sendVideoToMobileChunked(false); }}
                style={{ margin: '10px' }}
                disabled={!isConnected || uploading}
                title="Send this upload only to the specified Target ID (Android only)">
                {uploading && !isPaused ? 'Uploading...' : '📱 Send to Android Phone'}
              </button>

              <button
                className="broadcast-btn"
                onClick={() => {
                  if (!selectedVideo) { alert('Please select a video file first!'); return; }
                  const ok = window.confirm('Send this upload to ALL connected clients?');
                  if (ok) { setUploadBroadcast(true); sendVideoToMobileChunked(true); }
                }}
                style={{ margin: '10px' }}
                disabled={!isConnected || uploading}
                title="Send this upload to all connected Android clients">
                🔊 Send to All Connected Clients
              </button>

              {/* pause/resume/cancel/retry controls */}
              {uploading && (
                <>
                  {!isPaused ? (
                    <button onClick={pauseUpload} style={{ margin: '10px' }} title="Pause the ongoing upload">⏸ Pause</button>
                  ) : (
                    <button onClick={resumeUpload} style={{ margin: '10px' }} title="Resume the paused upload">▶ Resume</button>
                  )}
                  <button onClick={cancelUpload} style={{ margin: '10px' }} title="Cancel the upload in progress">✖ Cancel</button>
                </>
              )}

              {uploadError && (
                <button onClick={retryUpload} style={{ margin: '10px' }} title="Retry the upload from the beginning">↻ Retry</button>
              )}
            </div>

            {/* show progress while uploading (hide when reaches 100%) */}
            {(uploadProgress > 0 && uploadProgress < 100) && (
              <div className="upload-progress">
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${uploadProgress}%` }}></div>
                </div>
                <div style={{ marginTop: '6px' }}>
                  <strong>{uploadProgress}%</strong> • {uploadSpeed} • ETA: {uploadETA}
                </div>
              </div>
            )}

            {/* success message shown briefly */}
            {successMessage && (
              <div className="response-box success" style={{ marginTop: '10px' }}>
                <strong>✓ {successMessage}</strong>
              </div>
            )}
          </div>
        )}
      </div>


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

      {/* RECEIVER: registration controls */}
      <div className="role-section receiver-section" style={{ marginTop: '12px', padding: '10px', borderRadius: 6 }}>
        <div className="role-badge">RECEIVER</div>

        <div style={{ marginTop: '8px', display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            onClick={() => {
              if (!socket) return;
              if (!isRegistered) {
                socket.emit('register-device', 'android');
                setIsRegistered(true);
                setServerResponse('Registered as Android receiver');
              } else {
                // unregister by sending null device
                socket.emit('register-device', null);
                setIsRegistered(false);
                setLatestVideoUrl(null);
                setServerResponse('Unregistered as Android receiver');
              }
            }}
            disabled={!isConnected}
            title="Register or unregister this client as an Android receiver"
          >{!isRegistered ? '🔌 Register as Android Receiver' : '⛔ Unregister Receiver'}</button>

          <div>
            <div className="small-muted">Status: {isRegistered ? <strong style={{ color: '#059669' }}>Registered</strong> : <strong style={{ color: '#6b7280' }}>Not registered</strong>}</div>
          </div>
        </div>
      </div>

      {serverResponse && (
        <div className="response-box">
          <h3> Server Response:</h3>
          <p>{serverResponse}</p>
          <p><small>Time: {new Date().toLocaleTimeString()}</small></p>
        </div>
      )}

      {isRegistered && latestVideoUrl && (
        <div style={{ marginTop: '18px' }}>
          <h3>Latest Video (receiver)</h3>
          <video className="responsive-video" src={latestVideoUrl} controls playsInline controlsList="nodownload" style={{ maxWidth: '100%' }} />
          <p><a href={latestVideoUrl} target="_blank" rel="noreferrer">Open raw file</a></p>
        </div>
      )}
    </>
  );
}

export default App;