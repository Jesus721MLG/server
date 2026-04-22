import { Schema, type, MapSchema, ArraySchema } from "@colyseus/schema";

/**
 * Represents a connected player in the game room.
 * Extends Colyseus `Schema` so its properties are automatically
 * synchronised to every connected client.
 */
export class Player extends Schema {
    /**
     * The unique session identifier assigned by the Colyseus server
     * when the client connects.
     */
    @type('string')
    sessionId: string;

    /**
     * The 1-based seat number assigned to this player when they join
     * the room (1 for the first player, 2 for the second).
     */
    @type('int16')
    seat: number;
}

/**
 * Shared game state that is automatically synchronised to all clients
 * by the Colyseus framework.
 *
 * Game phases:
 * - `"waiting"` – fewer than two players are connected.
 * - `"place"`   – both players are placing their ships on the grid.
 * - `"battle"`  – both players have placed their ships; turns alternate.
 * - `"result"`  – the game is over and a winner has been determined.
 */
export class State extends Schema {
    /**
     * Current phase of the game.
     * One of `"waiting"`, `"place"`, `"battle"`, or `"result"`.
     */
    @type('string')
    phase: string = "waiting";

    /**
     * Seat number (1 or 2) of the player whose turn it currently is
     * during the `"battle"` phase.
     */
    @type('int16')
    playerTurn: number = 1;

    /**
     * Seat number of the player who won the game.
     * Set to `-1` while the game is still in progress.
     */
    @type('int16')
    winningPlayer: number = -1;

    /**
     * Map of session IDs to `Player` objects for all players currently
     * connected to the room.
     */
    @type({ map: Player })
    players: MapSchema<Player> = new MapSchema<Player>();

    /**
     * Flat array representing every cell on the grid from player 1's
     * perspective. Each element encodes the shot result for that cell:
     * - `0` – not yet fired upon.
     * - `1` – hit.
     * - `2` – miss.
     */
    @type(['int16'])
    player1Shots: ArraySchema<number> = new ArraySchema<number>();

    /**
     * Flat array representing every cell on the grid from player 2's
     * perspective. Uses the same encoding as `player1Shots`.
     */
    @type(['int16'])
    player2Shots: ArraySchema<number> = new ArraySchema<number>();
}