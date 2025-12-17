import { useEffect, useState } from 'react'
import io from 'socket.io-client'
import './App.css'
import Input from './components/input';

function App() {
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [serverResponse, setServerResponse] = useState('');

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
      console.log('Response from server:', data);
      setServerResponse(data);
    });


    return () => {
      newSocket.disconnect();
    };
  }, []);

  return (
    <>
      <h1>React Multiplayer Dashboard</h1>
      <Input placeholder="Enter your name" />

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