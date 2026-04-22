import { Room } from "colyseus";
import { State, Player } from './state';

/**
 * `GameRoom` manages a single two-player battleship-style match.
 *
 * Lifecycle overview:
 * 1. The room is created and immediately calls {@link reset} to initialise
 *    the game state.
 * 2. Up to two clients may join. When the second client connects the room is
 *    locked and the `"place"` phase begins.
 * 3. Each client sends a `"place"` command with their ship placement array.
 *    When both have placed, the `"battle"` phase begins.
 * 4. Players alternate sending `"turn"` commands. Each turn resolves as a
 *    hit or a miss. When all of an opponent's ship cells are hit the game
 *    moves to the `"result"` phase and the winner is recorded.
 */
export class GameRoom extends Room<State> {
    /** Maximum number of players allowed in a single room. */
    maxClients = 2;

    /** Side length of the square grid (e.g. 8 → 8 × 8 = 64 cells). */
    gridSize: number = 8;

    /**
     * Total number of ship-health points each player starts with.
     * Calculated as the sum of each ship's length: 2 + 3 + 5 = 10.
     */
    startingFleetHealth: number = 2 + 3 + 5;

    /**
     * Current health (remaining un-hit cells) for each player.
     * Index 0 → player 1, index 1 → player 2.
     */
    playerHealth: Array<number>;

    /**
     * Ship placement arrays submitted by each player.
     * `placements[0]` is player 1's placement, `placements[1]` is
     * player 2's. Each array has `gridSize * gridSize` elements where a
     * value greater than `0` indicates a ship occupies that cell.
     */
    placements: Array<Array<number>>;

    /** Number of players who have submitted their ship placement. */
    playersPlaced: number = 0;

    /** Total number of players who have joined the room. */
    playerCount: number = 0;

    /**
     * Called once by the Colyseus framework when the room is first created.
     * Initialises the game state via {@link reset}.
     *
     * @param options - Options passed to `gameServer.register()` or the
     *                  client-side `joinOrCreate` call.
     */
    onInit (options) {
        console.log("room created!", options);

        this.reset();
    }

    /**
     * Called by the Colyseus framework each time a client successfully
     * joins the room.
     *
     * - Creates a new `Player` object and stores it in the shared state.
     * - When the second player joins, the room is locked (no more joins
     *   allowed) and the phase transitions to `"place"`.
     *
     * @param client - The newly connected Colyseus client.
     */
    onJoin (client) {
        console.log("client joined", client.sessionId);

        let player: Player = new Player();
        player.sessionId = client.sessionId;
        player.seat = this.playerCount + 1;

        this.state.players[client.sessionId] = player;
        this.playerCount++;

        if (this.playerCount == 2) {
            this.state.phase = 'place';
            this.lock();
        }
    }

    /**
     * Called by the Colyseus framework when a client disconnects.
     *
     * Removes the player from the shared state, decrements the player
     * count, and resets the phase to `"waiting"` so a new player can
     * start a fresh game.
     *
     * @param client - The disconnected Colyseus client.
     */
    onLeave (client) {
        console.log("client left", client.sessionId);

        delete this.state.players[client.sessionId];
        this.playerCount--;
        this.state.phase = 'waiting';
    }

    /**
     * Called by the Colyseus framework whenever the server receives a
     * message from a client.
     *
     * Supported commands (passed as `message.command`):
     *
     * - **`"place"`** – Store the client's ship placement array
     *   (`message.placement`). When both players have placed their ships
     *   the phase advances to `"battle"`.
     *
     * - **`"turn"`** – Attempt to fire on cell `message.targetIndex`.
     *   Only processed if it is the sender's turn.
     *   - A *hit* sets the corresponding shot cell to `1` and decrements
     *     the opponent's health.
     *   - A *miss* sets the corresponding shot cell to `2`.
     *   - If the opponent's health reaches 0 the phase advances to
     *     `"result"` and `winningPlayer` is set; otherwise the turn
     *     passes to the other player.
     *
     * @param client  - The Colyseus client that sent the message.
     * @param message - The message payload, expected to have at minimum a
     *                  `command` string property.
     */
    onMessage (client, message) {
        console.log("message received", message);

        if (!message) return;

        let player: Player = this.state.players[client.sessionId];

        if (!player) return;

        let command: string = message['command'];

        switch (command) {
            case 'place':
                console.log('player ' + player.seat + ' placed ships');

                this.placements[player.seat - 1] = message['placement'];
                this.playersPlaced++;

                if (this.playersPlaced == 2) {
                    this.state.phase = 'battle';
                }
                break;
            case 'turn':
                if (this.state.playerTurn != player.seat) return; // ignore if not correct player

                let targetIndex = message['targetIndex'];

                console.log('player ' + player.seat + ' targets ' + targetIndex);

                let shots = player.seat == 1 ? this.state.player1Shots : this.state.player2Shots;
                let targetPlayerIndex = player.seat == 1 ? 1 : 0; // target zero-index of other player
                let targetedPlacement = this.placements[targetPlayerIndex];

                if (targetedPlacement[targetIndex] > 0 && shots[targetIndex] == 0) {
                    shots[targetIndex] = 1; // hit
                    this.playerHealth[targetPlayerIndex]--;
                } else if (targetedPlacement[targetIndex] == 0 && shots[targetIndex] == 0) {
                    shots[targetIndex] = 2; // miss
                }

                if (this.playerHealth[targetPlayerIndex] <= 0) {
                    this.state.winningPlayer = player.seat;
                    this.state.phase = "result";
                } else {
                    this.state.playerTurn = this.state.playerTurn == 1 ? 2 : 1;
                }
                break;
            default:
                console.log('unknown command');
        }
    }

    /**
     * Called by the Colyseus framework just before the room is destroyed
     * (i.e. all clients have disconnected and the room is being garbage
     * collected).
     */
    onDispose () {
        console.log("room destroyed!");
    }

    /**
     * Resets the room to its initial state, clearing all placements,
     * health values, and shot arrays.
     *
     * Called during `onInit` and can be used to restart a game without
     * recreating the room.
     */
    reset() {
        this.playerHealth = new Array<number>();
        this.playerHealth[0] = this.startingFleetHealth;
        this.playerHealth[1] = this.startingFleetHealth;

        this.placements = new Array<Array<number>>();
        this.placements[0] = new Array<number>();
        this.placements[1] = new Array<number>();

        let cellCount = this.gridSize * this.gridSize;
        let state = new State();

        state.phase = 'waiting';
        state.playerTurn = 1;
        state.winningPlayer = -1;

        for (var i=0; i<cellCount; i++) {
            this.placements[0][i] = 0;
            this.placements[1][i] = 0;
            
            state.player1Shots[i] = 0;
            state.player2Shots[i] = 0;
        }

        this.setState(state);
        this.playersPlaced = 0;
    }
}
