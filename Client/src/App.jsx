import { useEffect, useState } from 'react'
import io from 'socket.io-client'
import './App.css'

function App() {
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // Create socket connection
    const newSocket = io('http://localhost:3000');
    setSocket(newSocket);

    // Socket event listeners
    newSocket.on('connect', () => {
      console.log('Connected to server:', newSocket.id);
      setIsConnected(true);
    });

    newSocket.on('disconnect', () => {
      console.log('Disconnected from server');
      setIsConnected(false);
    });

    // Cleanup on unmount
    return () => {
      newSocket.disconnect();
    };
  }, []);

  return (
    <>
      <h1>React Multiplayer Dashboard</h1>
      <p>Connection status: {isConnected ? 'Connected' : 'Disconnected'}</p>
      <p>Socket ID: {socket?.id || 'Not connected'}</p>
    </>
  )
}

export default App
