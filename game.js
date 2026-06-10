const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");
const overlay = document.querySelector("#overlay");
const startButton = document.querySelector("#start-button");
const message = document.querySelector("#message");
const hud = {
  health: document.querySelector("#health"),
  ammo: document.querySelector("#ammo"),
  wave: document.querySelector("#wave"),
  score: document.querySelector("#score"),
};

const FOV = Math.PI / 3;
const RAY_COUNT = 240;
const TILE = 64;
const DEPTH = 960;
const PLAYER_RADIUS = 12;
const MAGAZINE_SIZE = 12;
const RESERVE_AMMO = 60;

const worldMap = [
  "###############",
  "#.....#.......#",
  "#.....#...#...#",
  "#.........#...#",
  "#..##.........#",
  "#.......###...#",
  "#.............#",
  "#...#.....#...#",
  "#...#.....#...#",
  "#.............#",
  "###############",
];

const mapHeight = worldMap.length;
const mapWidth = worldMap[0].length;
const keys = new Set();
const enemies = [];
const particles = [];
const shots = [];

let player;
let wave;
let score;
let lastTime;
let paused = true;
let gameOver = false;
let muzzleFlash = 0;
let reloadTimer = 0;
let damageFlash = 0;

function resetGame() {
  player = {
    x: TILE * 2.5,
    y: TILE * 2.5,
    angle: 0,
    health: 100,
    ammo: MAGAZINE_SIZE,
    reserve: RESERVE_AMMO,
  };
  wave = 1;
  score = 0;
  lastTime = performance.now();
  gameOver = false;
  reloadTimer = 0;
  damageFlash = 0;
  enemies.length = 0;
  particles.length = 0;
  shots.length = 0;
  spawnWave();
  updateHud();
}

function isWall(x, y) {
  if (x < 0 || y < 0) return true;
  const cellX = Math.floor(x / TILE);
  const cellY = Math.floor(y / TILE);
  return worldMap[cellY]?.[cellX] !== ".";
}

function spawnWave() {
  const spawnPoints = [
    [12.5, 1.5],
    [12.5, 8.5],
    [7.5, 8.5],
    [4.5, 6.5],
    [9.5, 3.5],
  ];
  const count = 3 + wave * 2;
  for (let i = 0; i < count; i += 1) {
    const [sx, sy] = spawnPoints[i % spawnPoints.length];
    enemies.push({
      x: sx * TILE + Math.random() * 18 - 9,
      y: sy * TILE + Math.random() * 18 - 9,
      health: 55 + wave * 10,
      speed: 35 + wave * 4,
      cooldown: Math.random() * 0.8,
      hit: 0,
    });
  }
}

function updateHud() {
  hud.health.textContent = Math.max(0, Math.ceil(player.health));
  hud.ammo.textContent = `${player.ammo} / ${player.reserve}`;
  hud.wave.textContent = wave;
  hud.score.textContent = score;
}

function startGame() {
  resetGame();
  paused = false;
  overlay.classList.add("hidden");
  message.classList.add("hidden");
  canvas.requestPointerLock?.();
  requestAnimationFrame(loop);
}

function pauseGame() {
  if (gameOver) return;
  paused = true;
  document.exitPointerLock?.();
  overlay.classList.remove("hidden");
  overlay.querySelector("h1").textContent = "Paused";
  overlay.querySelector("p").textContent = "Click deploy to jump back into the fight.";
  startButton.textContent = "Resume";
}

function reload() {
  if (reloadTimer > 0 || player.ammo === MAGAZINE_SIZE || player.reserve <= 0) return;
  reloadTimer = 0.9;
}

function finishReload() {
  const needed = MAGAZINE_SIZE - player.ammo;
  const loaded = Math.min(needed, player.reserve);
  player.ammo += loaded;
  player.reserve -= loaded;
  updateHud();
}

function shoot() {
  if (paused || gameOver || reloadTimer > 0) return;
  if (player.ammo <= 0) {
    reload();
    return;
  }

  player.ammo -= 1;
  muzzleFlash = 0.08;
  shots.push({ age: 0, angle: player.angle + (Math.random() - 0.5) * 0.035 });

  let best = null;
  for (const enemy of enemies) {
    const dx = enemy.x - player.x;
    const dy = enemy.y - player.y;
    const distance = Math.hypot(dx, dy);
    const angleToEnemy = normalizeAngle(Math.atan2(dy, dx) - player.angle);
    const hitWidth = Math.atan2(24, distance);

    if (Math.abs(angleToEnemy) < hitWidth && hasLineOfSight(player.x, player.y, enemy.x, enemy.y)) {
      if (!best || distance < best.distance) best = { enemy, distance };
    }
  }

  if (best) {
    const damage = best.distance < 220 ? 46 : 34;
    best.enemy.health -= damage;
    best.enemy.hit = 0.18;
    spawnParticles(best.enemy.x, best.enemy.y, "#fb7185", 12);
    if (best.enemy.health <= 0) {
      enemies.splice(enemies.indexOf(best.enemy), 1);
      score += 100;
      player.reserve = Math.min(99, player.reserve + 4);
      spawnParticles(best.enemy.x, best.enemy.y, "#facc15", 20);
    }
  }

  if (enemies.length === 0) {
    wave += 1;
    player.health = Math.min(100, player.health + 20);
    player.reserve += 18;
    spawnWave();
  }
  updateHud();
}

function hasLineOfSight(x1, y1, x2, y2) {
  const distance = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.max(1, Math.floor(distance / 8));
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    if (isWall(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)) return false;
  }
  return true;
}

function normalizeAngle(angle) {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function movePlayer(dt) {
  const sprint = keys.has("ShiftLeft") || keys.has("ShiftRight");
  const speed = (sprint ? 170 : 105) * dt;
  let forward = 0;
  let strafe = 0;

  if (keys.has("KeyW")) forward += 1;
  if (keys.has("KeyS")) forward -= 1;
  if (keys.has("KeyA")) strafe -= 1;
  if (keys.has("KeyD")) strafe += 1;

  const length = Math.hypot(forward, strafe) || 1;
  const stepForward = (forward / length) * speed;
  const stepStrafe = (strafe / length) * speed;
  const nextX = player.x + Math.cos(player.angle) * stepForward + Math.cos(player.angle + Math.PI / 2) * stepStrafe;
  const nextY = player.y + Math.sin(player.angle) * stepForward + Math.sin(player.angle + Math.PI / 2) * stepStrafe;

  if (!isWall(nextX + Math.sign(nextX - player.x) * PLAYER_RADIUS, player.y)) player.x = nextX;
  if (!isWall(player.x, nextY + Math.sign(nextY - player.y) * PLAYER_RADIUS)) player.y = nextY;
}

function updateEnemies(dt) {
  for (const enemy of enemies) {
    enemy.hit = Math.max(0, enemy.hit - dt);
    const dx = player.x - enemy.x;
    const dy = player.y - enemy.y;
    const distance = Math.hypot(dx, dy);
    enemy.cooldown -= dt;

    if (distance > 55) {
      const chase = enemy.speed * dt;
      const nx = enemy.x + (dx / distance) * chase;
      const ny = enemy.y + (dy / distance) * chase;
      if (!isWall(nx, enemy.y) && hasLineOfSight(enemy.x, enemy.y, player.x, player.y)) enemy.x = nx;
      if (!isWall(enemy.x, ny) && hasLineOfSight(enemy.x, enemy.y, player.x, player.y)) enemy.y = ny;
    } else if (enemy.cooldown <= 0) {
      enemy.cooldown = 0.7;
      player.health -= 8 + wave;
      damageFlash = 0.22;
      updateHud();
      if (player.health <= 0) endGame();
    }
  }
}

function spawnParticles(x, y, color, count) {
  for (let i = 0; i < count; i += 1) {
    particles.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 140,
      vy: (Math.random() - 0.5) * 140,
      color,
      life: 0.45 + Math.random() * 0.35,
    });
  }
}

function updateEffects(dt) {
  muzzleFlash = Math.max(0, muzzleFlash - dt);
  damageFlash = Math.max(0, damageFlash - dt);
  shots.forEach((shot) => (shot.age += dt));
  while (shots[0]?.age > 0.08) shots.shift();

  for (let i = particles.length - 1; i >= 0; i -= 1) {
    const particle = particles[i];
    particle.life -= dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    if (particle.life <= 0) particles.splice(i, 1);
  }

  if (reloadTimer > 0) {
    reloadTimer -= dt;
    if (reloadTimer <= 0) finishReload();
  }
}

function castRay(angle) {
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  for (let distance = 2; distance < DEPTH; distance += 3) {
    const x = player.x + cos * distance;
    const y = player.y + sin * distance;
    if (isWall(x, y)) return { distance, x, y };
  }
  return { distance: DEPTH, x: player.x + cos * DEPTH, y: player.y + sin * DEPTH };
}

function drawScene() {
  const w = canvas.width;
  const h = canvas.height;
  const horizon = h * 0.48;

  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, "#0f172a");
  sky.addColorStop(1, "#334155");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, horizon);

  const floor = ctx.createLinearGradient(0, horizon, 0, h);
  floor.addColorStop(0, "#475569");
  floor.addColorStop(1, "#111827");
  ctx.fillStyle = floor;
  ctx.fillRect(0, horizon, w, h - horizon);

  const zBuffer = [];
  const sliceWidth = w / RAY_COUNT;
  for (let i = 0; i < RAY_COUNT; i += 1) {
    const rayAngle = player.angle - FOV / 2 + (i / RAY_COUNT) * FOV;
    const ray = castRay(rayAngle);
    const corrected = ray.distance * Math.cos(rayAngle - player.angle);
    zBuffer[i] = corrected;
    const wallHeight = Math.min(h, (TILE * 560) / corrected);
    const shade = Math.max(32, 205 - corrected * 0.18);
    const edge = Math.abs((ray.x % TILE) - TILE / 2) > Math.abs((ray.y % TILE) - TILE / 2);
    ctx.fillStyle = edge ? `rgb(${shade * 0.65}, ${shade * 0.78}, ${shade})` : `rgb(${shade * 0.52}, ${shade * 0.62}, ${shade * 0.85})`;
    ctx.fillRect(i * sliceWidth, horizon - wallHeight / 2, sliceWidth + 1, wallHeight);
  }

  drawSprites(zBuffer, sliceWidth, horizon);
  drawWeapon();
  drawMinimap();

  if (damageFlash > 0) {
    ctx.fillStyle = `rgba(239, 68, 68, ${damageFlash * 1.6})`;
    ctx.fillRect(0, 0, w, h);
  }
}

function drawSprites(zBuffer, sliceWidth, horizon) {
  const sprites = enemies
    .map((enemy) => ({ enemy, distance: Math.hypot(enemy.x - player.x, enemy.y - player.y) }))
    .sort((a, b) => b.distance - a.distance);

  for (const { enemy, distance } of sprites) {
    const angle = normalizeAngle(Math.atan2(enemy.y - player.y, enemy.x - player.x) - player.angle);
    if (Math.abs(angle) > FOV / 1.45) continue;
    const screenX = (0.5 + angle / FOV) * canvas.width;
    const size = Math.min(canvas.height, (TILE * 430) / distance);
    const left = screenX - size / 2;
    const top = horizon - size * 0.5;
    const bufferIndex = Math.max(0, Math.min(RAY_COUNT - 1, Math.floor(screenX / sliceWidth)));
    if (distance > zBuffer[bufferIndex] + 18) continue;

    ctx.fillStyle = enemy.hit > 0 ? "#fecaca" : "#991b1b";
    ctx.fillRect(left + size * 0.22, top + size * 0.16, size * 0.56, size * 0.68);
    ctx.fillStyle = enemy.hit > 0 ? "#fff7ed" : "#ef4444";
    ctx.beginPath();
    ctx.arc(screenX, top + size * 0.18, size * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#111827";
    ctx.fillRect(left + size * 0.34, top + size * 0.14, size * 0.1, size * 0.04);
    ctx.fillRect(left + size * 0.56, top + size * 0.14, size * 0.1, size * 0.04);
  }

  for (const particle of particles) {
    const angle = normalizeAngle(Math.atan2(particle.y - player.y, particle.x - player.x) - player.angle);
    const distance = Math.hypot(particle.x - player.x, particle.y - player.y);
    if (Math.abs(angle) > FOV / 2 || distance > DEPTH) continue;
    const x = (0.5 + angle / FOV) * canvas.width;
    const y = horizon + (Math.random() - 0.5) * 28;
    ctx.fillStyle = particle.color;
    ctx.globalAlpha = Math.max(0, particle.life);
    ctx.fillRect(x, y, 4, 4);
    ctx.globalAlpha = 1;
  }
}

function drawWeapon() {
  const w = canvas.width;
  const h = canvas.height;
  const bob = Math.sin(performance.now() / 95) * (keys.size ? 4 : 1);

  ctx.fillStyle = "#0f172a";
  ctx.fillRect(w * 0.58, h * 0.72 + bob, w * 0.28, h * 0.12);
  ctx.fillStyle = "#1e293b";
  ctx.fillRect(w * 0.51, h * 0.78 + bob, w * 0.27, h * 0.17);
  ctx.fillStyle = "#020617";
  ctx.fillRect(w * 0.79, h * 0.755 + bob, w * 0.11, h * 0.045);
  ctx.fillStyle = "#64748b";
  ctx.fillRect(w * 0.55, h * 0.745 + bob, w * 0.22, h * 0.035);

  if (muzzleFlash > 0) {
    ctx.fillStyle = `rgba(250, 204, 21, ${muzzleFlash * 12})`;
    ctx.beginPath();
    ctx.arc(w * 0.91, h * 0.78 + bob, 26, 0, Math.PI * 2);
    ctx.fill();
  }

  if (reloadTimer > 0) {
    ctx.fillStyle = "rgba(2, 6, 23, 0.72)";
    ctx.fillRect(w * 0.35, h * 0.66, w * 0.3, 18);
    ctx.fillStyle = "#facc15";
    ctx.fillRect(w * 0.35, h * 0.66, w * 0.3 * (1 - reloadTimer / 0.9), 18);
  }
}

function drawMinimap() {
  const scale = 7;
  const padding = 16;
  const x0 = canvas.width - mapWidth * scale - padding;
  const y0 = canvas.height - mapHeight * scale - padding;

  ctx.fillStyle = "rgba(2, 6, 23, 0.72)";
  ctx.fillRect(x0 - 8, y0 - 8, mapWidth * scale + 16, mapHeight * scale + 16);
  for (let y = 0; y < mapHeight; y += 1) {
    for (let x = 0; x < mapWidth; x += 1) {
      ctx.fillStyle = worldMap[y][x] === "#" ? "#94a3b8" : "#1e293b";
      ctx.fillRect(x0 + x * scale, y0 + y * scale, scale - 1, scale - 1);
    }
  }
  ctx.fillStyle = "#22c55e";
  ctx.beginPath();
  ctx.arc(x0 + (player.x / TILE) * scale, y0 + (player.y / TILE) * scale, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#22c55e";
  ctx.beginPath();
  ctx.moveTo(x0 + (player.x / TILE) * scale, y0 + (player.y / TILE) * scale);
  ctx.lineTo(x0 + (player.x / TILE) * scale + Math.cos(player.angle) * 10, y0 + (player.y / TILE) * scale + Math.sin(player.angle) * 10);
  ctx.stroke();
  ctx.fillStyle = "#ef4444";
  enemies.forEach((enemy) => ctx.fillRect(x0 + (enemy.x / TILE) * scale - 2, y0 + (enemy.y / TILE) * scale - 2, 4, 4));
}

function endGame() {
  gameOver = true;
  paused = true;
  document.exitPointerLock?.();
  message.innerHTML = `<div><h2>Mission Failed</h2><p>Final score: ${score}. Survived to wave ${wave}.</p><button id="restart-button" type="button">Redeploy</button></div>`;
  message.classList.remove("hidden");
  document.querySelector("#restart-button").addEventListener("click", startGame);
}

function loop(now) {
  if (paused) return;
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  movePlayer(dt);
  updateEnemies(dt);
  updateEffects(dt);
  drawScene();
  requestAnimationFrame(loop);
}

startButton.addEventListener("click", () => {
  if (!player || gameOver) resetGame();
  paused = false;
  overlay.classList.add("hidden");
  canvas.requestPointerLock?.();
  lastTime = performance.now();
  requestAnimationFrame(loop);
});

canvas.addEventListener("click", () => {
  if (paused) return;
  if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
  shoot();
});

document.addEventListener("mousemove", (event) => {
  if (paused || document.pointerLockElement !== canvas) return;
  player.angle = normalizeAngle(player.angle + event.movementX * 0.0024);
});

document.addEventListener("keydown", (event) => {
  keys.add(event.code);
  if (event.code === "KeyR") reload();
  if (event.code === "Escape") pauseGame();
});

document.addEventListener("keyup", (event) => keys.delete(event.code));
document.addEventListener("pointerlockchange", () => {
  if (!gameOver && document.pointerLockElement !== canvas && !paused) pauseGame();
});

resetGame();
drawScene();
