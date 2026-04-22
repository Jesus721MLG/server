import express from 'express';
import { createServer } from 'http';
import { Server } from 'colyseus';
import { monitor } from '@colyseus/monitor';
import { GameRoom } from "./src/game-room";

/** Port the HTTP/WebSocket server will listen on. Defaults to `2567`. */
const port = Number(process.env.PORT || 2567);
const app = express();

/**
 * Colyseus game server.
 * Wraps a Node.js HTTP server so that both HTTP routes (e.g. the monitor
 * panel) and WebSocket connections are handled by the same process.
 */
const gameServer = new Server({
  server: createServer(app)
});

/**
 * Register the `GameRoom` room type under the name `"game"`.
 * Clients use this name when calling `client.joinOrCreate("game")`.
 */
gameServer.register("game", GameRoom);

/**
 * Mount the Colyseus monitor panel at `/colyseus`.
 * The panel provides a real-time view of all active rooms and connections.
 * It is optional and can be removed in production if not needed.
 */
app.use('/colyseus', monitor(gameServer));

/**
 * Callback executed when the game server begins its graceful shutdown
 * sequence (e.g. after receiving SIGTERM).
 */
gameServer.onShutdown(function(){
  console.log(`game server is going down.`);
});

gameServer.listen(port);

console.log(`Listening on http://localhost:${ port }`);
