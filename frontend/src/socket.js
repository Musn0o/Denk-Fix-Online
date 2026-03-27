import { io } from 'socket.io-client';

const URL = 'https://denk-fix-online.onrender.com';
export const socket = io(URL, {
  autoConnect: false
});
