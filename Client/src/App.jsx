import { useEffect, useState } from 'react'
import io from 'socket.io-client'
import './App.css'

function App() {
  const socket = io('localhost:3000')

  function connectSocket() {
    socket.on('connection', (socket) => {
      console.log(socket)
    });

  }

  useEffect(() => {

  }, [])
  return (
    <>
      <h1>React Multiplayer Dashboard</h1>
    </>
  )
}

export default App
