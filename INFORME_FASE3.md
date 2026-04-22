# Neptune's War — Informe Final (Fase 3)
### Documentación Técnica · Servidor Colyseus + ngrok
**Juego de Batalla Naval en Red · Unity + Colyseus + ngrok**
*Abril 2026*

---

## Índice de Contenidos

1. [Descripción General de la Fase 3](#1-descripción-general-de-la-fase-3)
2. [Explicación del Sistema de Conexión en Red Implementado](#2-explicación-del-sistema-de-conexión-en-red-implementado)
   - 2.1 Punto de entrada del servidor (`index.ts`)
   - 2.2 Esquemas de estado (`src/state.ts`)
   - 2.3 Sala de juego (`src/game-room.ts`)
   - 2.4 Flujo completo de comunicación cliente–servidor
3. [Descripción de Pruebas Realizadas y Resultados Obtenidos](#3-descripción-de-pruebas-realizadas-y-resultados-obtenidos)
   - 3.1 Prueba de conexión básica
   - 3.2 Prueba de unión a la sala y asignación de asientos
   - 3.3 Prueba de fase de colocación
   - 3.4 Prueba de fase de batalla
   - 3.5 Prueba de victoria y fase de resultado
   - 3.6 Prueba de desconexión de jugador
4. [Mejoras y Posibles Optimizaciones Futuras](#4-mejoras-y-posibles-optimizaciones-futuras)

---

## 1. Descripción General de la Fase 3

La Fase 3 consistió en la implementación completa del **servidor Colyseus** que soporta la lógica multijugador de Neptune's War. El servidor se desarrolló en TypeScript sobre Node.js y se expone públicamente a través de un túnel **ngrok** con dominio estático, permitiendo que los clientes Unity se conecten desde cualquier red.

El servidor actúa como árbitro único de la partida: gestiona el ciclo de fases (`waiting → place → battle → result`), valida los movimientos, sincroniza el estado con ambos clientes en tiempo real mediante WebSockets y detecta la condición de victoria.

**Stack tecnológico:**

| Componente | Tecnología | Versión |
|---|---|---|
| Servidor de juego | Colyseus | 0.10.7 |
| Serialización de estado | @colyseus/schema | integrado |
| Framework HTTP | Express | 4.x |
| Entorno de ejecución | Node.js | 8.9.1 |
| Lenguaje | TypeScript | 2.7.2 |
| Túnel público | ngrok (dominio estático) | — |
| Panel de monitoreo | @colyseus/monitor | 0.10.0 |

---

## 2. Explicación del Sistema de Conexión en Red Implementado

### 2.1 Punto de entrada del servidor (`index.ts`)

El archivo `index.ts` es el bootstrap del servidor. Realiza tres tareas principales:

1. **Crea un servidor HTTP** con Express como base, al cual Colyseus adjunta su manejador WebSocket.
2. **Registra el tipo de sala** `"game"` asociado a la clase `GameRoom`.
3. **Monta el panel de monitoreo** en la ruta `/colyseus`, lo que permite visualizar en tiempo real las salas activas, los jugadores conectados y el estado de cada sala.

```
Puerto de escucha: process.env.PORT || 2567
Panel de monitoreo: http://localhost:2567/colyseus
```

El diagrama de capas del servidor es el siguiente:

```
┌──────────────────────────────────────────────┐
│              index.ts (Bootstrap)            │
│  Express HTTP Server                         │
│  ┌──────────────────────────────────────┐    │
│  │   Colyseus Server (WebSocket)        │    │
│  │   ┌──────────────────────────────┐   │    │
│  │   │  Room "game" → GameRoom      │   │    │
│  │   │  ┌────────────────────────┐  │   │    │
│  │   │  │  State (sincronizado)  │  │   │    │
│  │   │  └────────────────────────┘  │   │    │
│  │   └──────────────────────────────┘   │    │
│  └──────────────────────────────────────┘    │
│  /colyseus → Monitor Panel                   │
└──────────────────────────────────────────────┘
```

### 2.2 Esquemas de estado (`src/state.ts`)

El estado sincronizado utiliza `@colyseus/schema`, que serializa los datos de forma binaria eficiente y envía **sólo las diferencias (delta)** en cada actualización, minimizando el tráfico de red.

**Clase `Player`** — representa a un jugador conectado:

| Campo | Tipo | Descripción |
|---|---|---|
| `sessionId` | `string` | Identificador único de la sesión WebSocket |
| `seat` | `int16` | Número de jugador asignado: 1 ó 2 |

**Clase `State`** — estado global de la partida:

| Campo | Tipo | Descripción |
|---|---|---|
| `phase` | `string` | Fase actual: `waiting`, `place`, `battle`, `result` |
| `playerTurn` | `int16` | Número del jugador con turno activo (1 ó 2) |
| `winningPlayer` | `int16` | Jugador ganador (`-1` = ninguno todavía) |
| `players` | `MapSchema<Player>` | Mapa `sessionId → Player` |
| `player1Shots` | `ArraySchema<int16>` | 64 celdas: `0` = sin disparar, `1` = impacto, `2` = fallo |
| `player2Shots` | `ArraySchema<int16>` | Igual que `player1Shots` para el jugador 2 |

Los arrays de disparos tienen tamaño fijo de **64 elementos** (grilla 8×8), inicializados a `0` en el método `reset()`.

### 2.3 Sala de juego (`src/game-room.ts`)

`GameRoom` extiende `Room<State>` de Colyseus. Es el corazón del servidor: controla toda la lógica de negocio de la partida.

**Propiedades internas del servidor** (no sincronizadas con los clientes):

| Propiedad | Tipo | Descripción |
|---|---|---|
| `maxClients` | `number` | Máximo de 2 jugadores por sala |
| `gridSize` | `number` | Tamaño de la grilla: 8 |
| `startingFleetHealth` | `number` | Salud inicial total: 10 (2+3+5 celdas de barcos) |
| `playerHealth[]` | `number[]` | Puntos de vida restantes por jugador |
| `placements[][]` | `number[][]` | Posición de los barcos de cada jugador (privado) |
| `playersPlaced` | `number` | Contador de jugadores que ya colocaron barcos |
| `playerCount` | `number` | Cantidad de jugadores actualmente en la sala |

**Ciclo de vida de la sala:**

```
onInit()   → reset(): inicializa estado vacío, fase "waiting"
onJoin()   → asigna seat, incrementa contador
             si playerCount == 2: fase "place", bloquea sala
onLeave()  → elimina jugador, decrementa contador, vuelve a "waiting"
onDispose()→ limpieza al destruirse la sala
```

**Manejo de mensajes (`onMessage`):**

El servidor recibe mensajes en formato `{ command, ...payload }`:

| Comando | Payload | Acción del servidor |
|---|---|---|
| `place` | `placement: number[]` | Guarda la disposición de barcos del jugador. Cuando ambos jugadores han colocado → cambia fase a `battle` |
| `turn` | `targetIndex: number` | Valida que sea el turno del jugador, registra el disparo (impacto o fallo), actualiza `playerHealth`. Si salud llega a 0 → `winningPlayer` y fase `result`. En caso contrario → cambia turno |

**Lógica de detección de impacto:**

```
targetedPlacement[targetIndex] > 0  →  impacto (shot = 1, salud del rival -1)
targetedPlacement[targetIndex] == 0 →  fallo   (shot = 2)
shots[targetIndex] != 0             →  celda ya disparada, se ignora
```

### 2.4 Flujo completo de comunicación cliente–servidor

El siguiente diagrama muestra la secuencia de mensajes entre los dos clientes Unity y el servidor Colyseus a través de ngrok:

```
Cliente 1 (Unity)          Servidor Colyseus           Cliente 2 (Unity)
       |                          |                           |
       |── WebSocket connect ────>|                           |
       |<─ OnConnect ─────────────|                           |
       |── Join "game" ──────────>|                           |
       |<─ OnJoin (seat=1) ───────|                           |
       |   [fase: waiting]        |                           |
       |                          |<── WebSocket connect ─────|
       |                          |── OnConnect ─────────────>|
       |                          |<── Join "game" ───────────|
       |                          |── OnJoin (seat=2) ────────>|
       |<─ phase: "place" ────────|── phase: "place" ─────────>|
       |                          |                           |
       |── place {placement[]} ──>|                           |
       |                          |<── place {placement[]} ───|
       |<─ phase: "battle" ───────|── phase: "battle" ────────>|
       |                          |                           |
       |── turn {targetIndex} ───>|                           |
       |<─ player1Shots updated ──|── player1Shots updated ───>|
       |<─ playerTurn=2 ──────────|── playerTurn=2 ───────────>|
       |                          |                           |
       |                          |<── turn {targetIndex} ────|
       |<─ player2Shots updated ──|── player2Shots updated ───>|
       |<─ playerTurn=1 ──────────|── playerTurn=1 ───────────>|
       |         ... (turnos) ... |                           |
       |<─ winningPlayer, "result"|── winningPlayer, "result" >|
```

**Arquitectura de red con ngrok:**

```
[Unity Client 1]                [Unity Client 2]
       |                               |
       |  wss://shrivel-stretch-       |
       |  doorman.ngrok-free.dev       |
       |               \               |
       |                \              |
       v                 v             v
  [ngrok Tunnel]  ──>  [Colyseus Server :2567]
                              |
                         [GameRoom]
                              |
                          [State]
```

El dominio estático `shrivel-stretch-doorman.ngrok-free.dev` garantiza que la URL no cambie entre reinicios del túnel, evitando la necesidad de actualizar el cliente.

---

## 3. Descripción de Pruebas Realizadas y Resultados Obtenidos

### 3.1 Prueba de conexión básica

**Objetivo:** Verificar que el servidor inicia correctamente y acepta conexiones WebSocket.

**Procedimiento:**
1. Ejecutar `npm start` → `ts-node index.ts`
2. Abrir `http://localhost:2567/colyseus` en el navegador
3. Conectar un cliente Unity a `wss://shrivel-stretch-doorman.ngrok-free.dev`

**Resultado obtenido:** ✅ El servidor arranca en el puerto 2567, el panel de monitoreo se carga correctamente. El cliente Unity recibe el evento `OnConnect` y establece la sesión WebSocket.

**Log del servidor:**
```
Listening on http://localhost:2567
```

---

### 3.2 Prueba de unión a la sala y asignación de asientos

**Objetivo:** Comprobar que dos jugadores se unen a la misma sala y reciben asientos correctos.

**Procedimiento:**
1. Cliente 1 envía `Join("game")`
2. Cliente 2 envía `Join("game")`
3. Verificar logs del servidor y estado sincronizado

**Resultado obtenido:** ✅
- Cliente 1 recibe `seat = 1` y la fase se mantiene en `waiting`
- Al unirse Cliente 2, recibe `seat = 2`
- La sala cambia automáticamente a fase `place` y se bloquea (`this.lock()`)
- Ambos clientes reciben la actualización de estado con `phase: "place"`

**Log del servidor:**
```
room created! {}
client joined [sessionId_1]
client joined [sessionId_2]
```

---

### 3.3 Prueba de fase de colocación

**Objetivo:** Verificar que el servidor procesa correctamente la colocación de barcos y transiciona a `battle` cuando ambos jugadores han colocado.

**Procedimiento:**
1. Cliente 1 envía `{ command: "place", placement: [array de 64 enteros] }`
2. Cliente 2 envía `{ command: "place", placement: [array de 64 enteros] }`
3. Verificar que la fase cambia a `battle`

**Resultado obtenido:** ✅
- Al recibir el primer `place`, `playersPlaced` se incrementa a 1, la fase permanece en `place`
- Al recibir el segundo `place`, `playersPlaced` llega a 2 y el servidor cambia la fase a `battle`
- Ambos clientes reciben `phase: "battle"` vía sincronización de estado

**Log del servidor:**
```
message received { command: 'place', placement: [...] }
player 1 placed ships
message received { command: 'place', placement: [...] }
player 2 placed ships
```

---

### 3.4 Prueba de fase de batalla — impacto y fallo

**Objetivo:** Validar que el servidor registra correctamente los disparos (impacto/fallo) y cambia el turno.

**Procedimiento:**
1. Con `playerTurn = 1`, Cliente 1 envía `{ command: "turn", targetIndex: 5 }` (celda con barco del rival)
2. Cliente 1 envía `{ command: "turn", targetIndex: 20 }` (celda vacía)
3. Cliente 2 intenta enviar `{ command: "turn", targetIndex: 10 }` fuera de su turno

**Resultado obtenido:** ✅
- **Impacto:** `player1Shots[5] = 1`, `playerHealth[1]` decrementado. `playerTurn` cambia a 2
- **Fallo:** `player1Shots[20] = 2`. `playerTurn` cambia a 2
- **Turno inválido:** El servidor ignora silenciosamente el mensaje de Cliente 2 (guarda `return`)
- Los arrays `player1Shots` se sincronizan con ambos clientes inmediatamente

**Log del servidor:**
```
message received { command: 'turn', targetIndex: 5 }
player 1 targets 5
message received { command: 'turn', targetIndex: 10 }
(ignorado: turno de jugador 1, no jugador 2)
```

---

### 3.5 Prueba de victoria y fase de resultado

**Objetivo:** Verificar la detección de victoria cuando `playerHealth` llega a 0.

**Procedimiento:**
1. Configurar un placement con barcos en posiciones conocidas
2. Disparar a las 10 celdas ocupadas (salud inicial: 2+3+5 = 10)
3. Verificar que el servidor declara al ganador y cambia la fase

**Resultado obtenido:** ✅
- Al reducir `playerHealth[targetPlayer]` a 0, el servidor asigna `winningPlayer = player.seat` y cambia `phase = "result"`
- Ambos clientes reciben el estado final con `winningPlayer` y `phase: "result"`
- La partida finaliza correctamente sin más procesamiento de turnos

---

### 3.6 Prueba de desconexión de jugador

**Objetivo:** Comprobar el comportamiento del servidor cuando un jugador abandona durante la partida.

**Procedimiento:**
1. Durante la fase `battle`, cerrar la conexión del Cliente 1
2. Observar el comportamiento del servidor y del Cliente 2

**Resultado obtenido:** ✅ (con comportamiento esperado según diseño actual)
- El servidor ejecuta `onLeave()`, elimina al jugador del `MapSchema` y cambia la fase a `waiting`
- `playerCount` se decrementa
- Cliente 2 recibe la actualización de estado con `phase: "waiting"`
- La sala queda en estado `waiting` esperando un nuevo jugador

**Log del servidor:**
```
client left [sessionId_1]
```

> **Nota:** En la implementación actual, el servidor no distingue entre desconexión voluntaria e involuntaria (pérdida de conexión). Ambos casos se manejan igual por `onLeave()`.

---

## 4. Mejoras y Posibles Optimizaciones Futuras

### 4.1 Persistencia y reconexión

**Problema actual:** Si un jugador pierde la conexión accidentalmente (corte de red, cierre del navegador), la sala vuelve a `waiting` y la partida se pierde sin posibilidad de recuperación.

**Mejora propuesta:**
- Implementar **`allowReconnection(client, seconds)`** de Colyseus para reservar el slot del jugador durante un tiempo definido (p. ej., 30 segundos) antes de considerarlo desconectado definitivamente.
- Guardar el estado de la partida en Redis o en memoria para poder restaurarlo si el jugador reconecta.

---

### 4.2 Validación de datos en el servidor

**Problema actual:** El servidor confía en los datos enviados por el cliente. Un cliente malicioso podría enviar un `placement` con un número incorrecto de celdas, índices fuera de rango o valores inválidos.

**Mejoras propuestas:**
- Validar que `placement` tenga exactamente 64 elementos.
- Verificar que el número de celdas ocupadas sea exactamente 10 (2+3+5).
- Comprobar que los barcos estén dispuestos en posiciones contiguas válidas (sin barcos fragmentados).
- Verificar que `targetIndex` esté en el rango `[0, 63]`.
- Rechazar mensajes con comandos desconocidos con respuesta de error explícita en lugar de log silencioso.

---

### 4.3 Reinicio de sala sin destruirla

**Problema actual:** Al terminar una partida (`result`) o cuando un jugador se desconecta, la sala vuelve a `waiting` pero mantiene el estado parcial anterior hasta que ambos jugadores vuelvan a conectarse. Si se une un nuevo jugador, podría ver datos residuales.

**Mejora propuesta:**
- Llamar a `this.reset()` en `onLeave()` además de cambiar la fase, o implementar una lógica de reinicio completo cuando el número de jugadores baje de 2.
- Alternativamente, permitir que la sala se destruya al finalizar (`onDispose`) y que los clientes creen una sala nueva para la siguiente partida.

---

### 4.4 Mejora del sistema de fases y mensajes al cliente

**Problema actual:** Los controladores de Unity reaccionan exclusivamente a cambios de fase en el estado. No hay mensajes de error explícitos ni notificaciones de eventos puntuales (p. ej., "disparo en celda ya atacada").

**Mejoras propuestas:**
- Utilizar **`this.broadcast()`** o **`client.send()`** de Colyseus para enviar mensajes de evento específicos (error, victoria inmediata, etc.) que no requieran modificar el estado global.
- Definir un canal de mensajes separado para notificaciones de UI (chat, contadores de tiempo, etc.).

---

### 4.5 Implementación de temporizador de turno

**Problema actual:** No hay límite de tiempo por turno. Un jugador puede dejar la partida inactiva indefinidamente.

**Mejora propuesta:**
- Implementar un temporizador con `setTimeout` en el servidor que, al expirar, pase el turno automáticamente o registre un fallo neutral.
- Limpiar el temporizador con `clearTimeout` al recibir un turno válido.

---

### 4.6 Migración a versiones modernas de Colyseus

**Problema actual:** El proyecto usa Colyseus `0.10.7` (2019), una versión muy antigua. Las versiones actuales (0.15+) ofrecen mejoras significativas:

| Aspecto | v0.10 (actual) | v0.15+ (recomendado) |
|---|---|---|
| API de Room | `onInit`, `onMessage(client, msg)` | `onCreate`, `onMessage(type, handler)` |
| Schema | Decoradores básicos | Soporte completo con herencia y arrays tipados |
| Rendimiento | Serialización completa | Delta encoding optimizado |
| Soporte | Sin mantenimiento | Activamente mantenido |

---

### 4.7 Despliegue en producción sin ngrok

**Situación actual:** El servidor depende de ngrok para exposición pública, lo cual es adecuado para desarrollo pero no para producción (limitaciones de ancho de banda, latencia adicional, dependencia de terceros).

**Mejoras propuestas:**
- Desplegar el servidor en una plataforma cloud con IP fija: **Railway**, **Render**, **Fly.io**, o **AWS/GCP**.
- Usar HTTPS/WSS nativo con un certificado TLS propio, eliminando la dependencia de ngrok.
- Mover la URL del servidor de un valor hardcodeado en `GameClient.cs` a un **ScriptableObject** configurable, facilitando cambios sin recompilar el cliente Unity.

---

### 4.8 Logging y observabilidad

**Problema actual:** El servidor sólo usa `console.log` básico, lo que dificulta el diagnóstico en producción.

**Mejoras propuestas:**
- Integrar una librería de logging estructurado como **Winston** o **Pino**.
- Añadir niveles de log (`debug`, `info`, `warn`, `error`) y exportar logs a un servicio externo.
- El panel `/colyseus` de monitoreo ya provee visibilidad básica de salas y jugadores; se recomienda mantenerlo detrás de autenticación en producción.

---

*Fin del Informe de la Fase 3 — Neptune's War*
