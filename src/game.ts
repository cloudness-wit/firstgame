import { isSoundEnabled, playSound, setSoundEnabled, unlockAudio } from './audio.js';
import { gameplayHaptic, initializeMobile, loadBestAltitude, loadBestScore, loadLifetimeCoins, requestTiltPermission, saveBestAltitude, saveBestScore, saveLifetimeCoins, setGameAwake } from './mobile.js';
import { calculateScore, isLandingOnHazard, randomCoinTrailCount } from './gameRules.js';

type AnimationName = 'idle' | 'walk' | 'run' | 'jump' | 'fall';
type PlatformKind = 'normal' | 'moving' | 'crumbling' | 'spring';
type Platform = {
  x: number;
  y: number;
  width: number;
  height: number;
  kind: PlatformKind;
  moveMinX?: number;
  moveMaxX?: number;
  moveSpeed?: number;
  moveDirection?: number;
  frameDeltaX?: number;
  crumbleTimer?: number;
};
type FrameSet = { image: HTMLImageElement; count: number; fps: number };
type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  maxLife: number;
  gravity: number;
  color: string;
  shape: 'dust' | 'spark' | 'debris';
};
type Hazard = { platform: Platform; x: number; width: number; height: number };
type Enemy = { platform: Platform; x: number; y: number; width: number; height: number; speed: number; direction: number; removed: boolean };
type PickupKind = 'coin' | 'shield' | 'rocket' | 'magnet';
type Pickup = { kind: PickupKind; x: number; y: number; radius: number; phase: number; collected: boolean };

const WIDTH = 360;
const HEIGHT = 540;
const PHYSICS = {
  maxSpeed: 270,
  acceleration: 1500,
  deceleration: 1900,
  gravity: 1500,
  jumpVelocity: 800,
  autoJumpDelay: 0.32,
  playerWidth: 38,
  playerHeight: 60,
};

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const ctx = canvas.getContext('2d')!;
const stage = document.querySelector<HTMLElement>('.stage')!;
const panel = document.querySelector<HTMLElement>('#panel')!;
const panelTitle = document.querySelector<HTMLElement>('#panel-title')!;
const panelCopy = document.querySelector<HTMLElement>('#panel-copy')!;
const panelStats = document.querySelector<HTMLElement>('#panel-stats')!;
const startButton = document.querySelector<HTMLButtonElement>('#start')!;
const soundToggleButton = document.querySelector<HTMLButtonElement>('#sound-toggle')!;
const pauseButton = document.querySelector<HTMLButtonElement>('#pause')!;
const tiltButton = document.querySelector<HTMLButtonElement>('#tilt')!;

const image = (src: string): HTMLImageElement => {
  const result = new Image();
  result.src = src;
  return result;
};
const platformArt = image('./assets/frames/platform-ref.png');
const animations: Record<AnimationName, FrameSet> = {
  idle: { image: image('./assets/frames/idle.png'), count: 4, fps: 4 },
  walk: { image: image('./assets/frames/walk.png'), count: 4, fps: 8 },
  run: { image: image('./assets/frames/run8.png'), count: 8, fps: 12 },
  jump: { image: image('./assets/frames/jump.png'), count: 4, fps: 9 },
  // The available jump GIF's final two poses are reused as a fall pose.
  fall: { image: image('./assets/frames/jump.png'), count: 4, fps: 5 },
};

const START_Y = 402;
const INITIAL_PLATFORMS: Platform[] = [
  { x: 116, y: 462, width: 128, height: 13, kind: 'normal' },
  { x: 34, y: 330, width: 94, height: 12, kind: 'normal' },
  { x: 220, y: 198, width: 100, height: 12, kind: 'normal' },
  { x: 96, y: 66, width: 104, height: 12, kind: 'normal' },
  { x: 20, y: -66, width: 92, height: 12, kind: 'normal' },
];
let platforms: Platform[] = INITIAL_PLATFORMS.map((platform) => ({ ...platform }));
let generatedPlatformIndex = 0;
let cameraY = 0;
let peakPlayerY = START_Y;

let recordMeters = 0;
let bestScore = 0;
let lifetimeCoins = 0;

const player = { x: 161, y: START_Y, vx: 0, vy: 0, grounded: true, groundedFor: 0, animation: 'idle' as AnimationName, facing: 1 };
let supportingPlatform: Platform | null = null;
const keys = new Set<string>();
const pointers = new Map<number, number>();
let started = false;
let paused = false;
let lost = false;
let previous = 0;
let animationClock = 0;
let tiltEnabled = false;
let tiltCenter = 0;
let latestGamma: number | null = null;
let targetTilt = 0;
let smoothTilt = 0;
const particles: Particle[] = [];
let footstepDustClock = 0;
let jumpLight = 0;
let hazards: Hazard[] = [];
let enemies: Enemy[] = [];
let pickups: Pickup[] = [];
let runCoins = 0;
let scorePopups: { x: number; y: number; text: string; color: string; life: number }[] = [];
let shieldTimer = 0;
let rocketTimer = 0;
let magnetTimer = 0;
let invulnerableTimer = 0;
let rocketTrailClock = 0;

function scoreFor(altitude: number): number {
  return calculateScore(altitude, runCoins);
}

function setPanel(title: string, copy: string, button: string, stats = ''): void {
  panelTitle.textContent = title;
  panelCopy.textContent = copy;
  panelStats.textContent = stats;
  startButton.textContent = button;
  refreshSoundToggle();
  panel.classList.remove('hidden');
}

function refreshSoundToggle(): void {
  const soundOn = isSoundEnabled();
  soundToggleButton.textContent = soundOn ? 'SOM: LIGADO' : 'SOM: DESLIGADO';
  soundToggleButton.setAttribute('aria-pressed', String(soundOn));
}

function menuStats(): string {
  return `Recorde: ${recordMeters} m · ${bestScore.toLocaleString('pt-BR')} pontos\nMoedas acumuladas: ${lifetimeCoins.toLocaleString('pt-BR')}`;
}

function finishGame(reason: 'hazard' | 'fall'): void {
  if (lost) return;
  lost = true;
  stage.classList.remove('is-running');
  stage.classList.remove('is-paused');
  void setGameAwake(false);
  const altitude = Math.max(0, Math.floor((START_Y - peakPlayerY) / 2));
  const score = scoreFor(altitude);
  const newRecord = score > bestScore;
  if (newRecord) {
    bestScore = score;
    playSound('record');
    void gameplayHaptic('record');
    void saveBestScore(bestScore);
  } else {
    playSound('gameover');
    void gameplayHaptic('hit');
  }
  lifetimeCoins += runCoins;
  void saveLifetimeCoins(lifetimeCoins);
  emitParticles(player.x + PHYSICS.playerWidth / 2, player.y + PHYSICS.playerHeight / 2, '#ff785e', 12, 'spark', 125);
  const message = reason === 'hazard'
    ? 'Um obstáculo encerrou a subida. Tente outra vez!'
    : 'Você caiu abaixo da última plataforma. Tente outra tentativa.';
  const stats = `ALTURA  ${altitude} m\nPONTOS  ${score.toLocaleString('pt-BR')}${newRecord ? '  ·  NOVO RECORDE!' : ''}\nMOEDAS  +${runCoins}  ·  TOTAL ${lifetimeCoins.toLocaleString('pt-BR')}\nRECORDE  ${bestScore.toLocaleString('pt-BR')} pontos`;
  setPanel('Fim de jogo', message, 'REINICIAR', stats);
}

void Promise.all([loadBestAltitude(), loadBestScore(), loadLifetimeCoins()]).then(([altitude, score, coins]) => {
  recordMeters = Math.max(recordMeters, altitude);
  bestScore = Math.max(bestScore, score);
  lifetimeCoins = Math.max(lifetimeCoins, coins);
  if (!started && !lost && !paused) panelStats.textContent = menuStats();
});
refreshSoundToggle();

function startGame(): void {
  if (started && !lost) return;
  unlockAudio();
  platforms = INITIAL_PLATFORMS.map((platform) => ({ ...platform }));
  generatedPlatformIndex = 0;
  hazards = [];
  enemies = [];
  pickups = [];
  runCoins = 0;
  scorePopups = [];
  shieldTimer = 0;
  rocketTimer = 0;
  magnetTimer = 0;
  invulnerableTimer = 0;
  rocketTrailClock = 0;
  seedInitialPickups();
  cameraY = 0;
  peakPlayerY = START_Y;
  player.x = 161;
  player.y = platforms[0].y - PHYSICS.playerHeight;
  player.vx = 0;
  player.vy = -PHYSICS.jumpVelocity;
  player.grounded = false;
  supportingPlatform = null;
  player.groundedFor = 0;
  player.animation = 'jump';
  playSound('jump');
  particles.length = 0;
  jumpLight = 0;
  void setGameAwake(true);
  started = true;
  paused = false;
  lost = false;
  stage.classList.add('is-running');
  stage.classList.remove('is-paused');
  panel.classList.add('hidden');
}

function setPaused(next: boolean): void {
  if (!started || lost) return;
  paused = next;
  stage.classList.toggle('is-running', !paused);
  stage.classList.toggle('is-paused', paused);
  void setGameAwake(!paused);
  if (paused) {
    const altitude = Math.max(0, Math.floor((START_Y - peakPlayerY) / 2));
    setPanel('Pausado', 'Retome quando estiver pronto.', 'CONTINUAR', `ALTURA  ${altitude} m\nPONTOS  ${scoreFor(altitude).toLocaleString('pt-BR')}\nMOEDAS  ${runCoins}  ·  RECORDE ${bestScore.toLocaleString('pt-BR')}`);
  }
  else panel.classList.add('hidden');
}

startButton.addEventListener('click', () => {
  if (paused && !lost) setPaused(false);
  else startGame();
});
pauseButton.addEventListener('click', () => setPaused(!paused));
soundToggleButton.addEventListener('click', () => {
  setSoundEnabled(!isSoundEnabled());
  refreshSoundToggle();
  if (isSoundEnabled()) playSound('buff');
});

void initializeMobile();
window.addEventListener('deviceorientation', (event) => {
  if (event.gamma !== null) latestGamma = event.gamma;
});
tiltButton.addEventListener('click', async () => {
  if (tiltEnabled) {
    tiltEnabled = false;
    targetTilt = 0;
    tiltButton.textContent = 'INCL.';
    tiltButton.setAttribute('aria-pressed', 'false');
    return;
  }
  tiltButton.disabled = true;
  tiltButton.textContent = 'CALIBRANDO';
  const permissionGranted = await requestTiltPermission();
  const sensorReady = permissionGranted && await waitForTiltSample();
  tiltButton.disabled = false;
  if (!sensorReady) {
    tiltEnabled = false;
    tiltButton.setAttribute('aria-pressed', 'false');
    tiltButton.textContent = permissionGranted ? 'SEM SENSOR' : 'PERMISSÃO NEGADA';
    window.setTimeout(() => { if (!tiltEnabled) tiltButton.textContent = 'INCL.'; }, 1600);
    return;
  }
  tiltCenter = latestGamma!;
  tiltEnabled = true;
  tiltButton.textContent = 'INCL. ON';
  tiltButton.setAttribute('aria-pressed', 'true');
});

function waitForTiltSample(timeoutMs = 900): Promise<boolean> {
  if (latestGamma !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const poll = window.setInterval(() => {
      if (latestGamma !== null) {
        window.clearInterval(poll);
        resolve(true);
      } else if (performance.now() - startedAt >= timeoutMs) {
        window.clearInterval(poll);
        resolve(false);
      }
    }, 50);
  });
}

window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  if (['arrowleft', 'arrowright', ' '].includes(key)) event.preventDefault();
  keys.add(key);
  if (key === 'm') {
    setSoundEnabled(!isSoundEnabled());
    refreshSoundToggle();
    if (isSoundEnabled()) playSound('buff');
  }
  if ((key === 'enter' || key === ' ') && (!started || lost)) startGame();
  if (key === 'escape') setPaused(!paused);
});
window.addEventListener('keyup', (event) => keys.delete(event.key.toLowerCase()));
window.addEventListener('blur', () => { keys.clear(); pointers.clear(); });

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    keys.clear();
    pointers.clear();
    if (started && !paused && !lost) setPaused(true);
  }
});

stage.addEventListener('pointerdown', (event) => {
  const bounds=stage.getBoundingClientRect(), px=(event.clientX-bounds.left)*WIDTH/bounds.width, py=(event.clientY-bounds.top)*HEIGHT/bounds.height;
  if(started && px>WIDTH-52 && py<46){setPaused(!paused);return;}
  if (!started || paused || lost || event.target === startButton || event.target === tiltButton) return;
  stage.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, event.clientX < bounds.left + bounds.width / 2 ? -1 : 1);
});
stage.addEventListener('pointermove', (event) => {
  if (!pointers.has(event.pointerId) || paused || lost) return;
  const bounds = stage.getBoundingClientRect();
  pointers.set(event.pointerId, event.clientX < bounds.left + bounds.width / 2 ? -1 : 1);
});
stage.addEventListener('pointerup', (event) => pointers.delete(event.pointerId));
stage.addEventListener('pointercancel', (event) => pointers.delete(event.pointerId));

function horizontalInput(): number {
  const left = keys.has('a') || keys.has('arrowleft');
  const right = keys.has('d') || keys.has('arrowright');
  const touch = [...pointers.values()].reduce((sum, side) => sum + side, 0);
  return Math.max(-1, Math.min(1, Number(right) - Number(left) + touch + smoothTilt));
}

function emitParticles(
  x: number,
  y: number,
  color: string,
  count: number,
  shape: Particle['shape'] = 'dust',
  lift = 90,
): void {
  for (let i = 0; i < count && particles.length < 180; i += 1) {
    const life = 0.32 + Math.random() * 0.46;
    particles.push({
      x: x + (Math.random() - 0.5) * 12,
      y: y + (Math.random() - 0.5) * 4,
      vx: (Math.random() - 0.5) * 150,
      vy: -Math.random() * lift,
      size: shape === 'debris' ? 2 + Math.random() * 3 : 1.5 + Math.random() * 3,
      life,
      maxLife: life,
      gravity: shape === 'debris' ? 360 : 90,
      color,
      shape,
    });
  }
}

function updateParticles(dt: number): void {
  for (const particle of particles) {
    particle.life -= dt;
    particle.vy += particle.gravity * dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vx *= Math.max(0, 1 - dt * 1.8);
  }
  for (let i = particles.length - 1; i >= 0; i -= 1) {
    if (particles[i].life <= 0) particles.splice(i, 1);
  }
}

function drawParticles(): void {
  ctx.save();
  for (const particle of particles) {
    const screenY = particle.y - cameraY;
    if (screenY < -20 || screenY > HEIGHT + 20) continue;
    const alpha = Math.max(0, particle.life / particle.maxLife);
    ctx.globalAlpha = alpha * (particle.shape === 'spark' ? 0.95 : 0.72);
    ctx.fillStyle = particle.color;
    if (particle.shape === 'spark') {
      ctx.strokeStyle = particle.color;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(particle.x - particle.vx * 0.035, screenY - particle.vy * 0.035);
      ctx.lineTo(particle.x, screenY);
      ctx.stroke();
    } else if (particle.shape === 'debris') {
      ctx.save();
      ctx.translate(particle.x, screenY);
      ctx.rotate((1 - alpha) * 3);
      ctx.fillRect(-particle.size / 2, -particle.size / 2, particle.size, particle.size);
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.arc(particle.x, screenY, particle.size * (0.6 + alpha * 0.4), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function ensurePlatformsAhead(): void {
  let highest = Math.min(...platforms.map((platform) => platform.y));
  while (highest > cameraY - 190) {
    const altitude = Math.max(0, Math.floor((START_Y - peakPlayerY) / 2));
    const difficulty = Math.min(1, altitude / 900);
    const largestGap = 150 + difficulty * 12;
    const gap = 126 + Math.random() * (largestGap - 126);
    const width = Math.max(76, 104 - difficulty * 20);
    const previous = platforms.find((platform) => platform.y === highest)!;
    const fallTime = (PHYSICS.jumpVelocity + Math.sqrt(Math.max(0, PHYSICS.jumpVelocity ** 2 - 2 * PHYSICS.gravity * gap))) / PHYSICS.gravity;
    const centerReach = Math.min(150, PHYSICS.maxSpeed * fallTime * 0.64);
    const previousMinCenter = (previous.moveMinX ?? previous.x) + previous.width / 2;
    const previousMaxCenter = (previous.moveMaxX ?? previous.x) + previous.width / 2;
    const minCenter = Math.max(0, previousMaxCenter - centerReach);
    const maxCenter = Math.min(WIDTH, previousMinCenter + centerReach);
    const minX = Math.max(0, minCenter - width / 2);
    const maxX = Math.max(minX, Math.min(WIDTH - width, maxCenter - width / 2));
    const kind = choosePlatformKind(difficulty, previous.kind);
    const x = minX + Math.random() * (maxX - minX);
    highest -= gap;
    const platform: Platform = { x, y: highest, width, height: 12, kind };
    if (kind === 'moving') {
      const travel = 18 + Math.random() * (22 + difficulty * 12);
      platform.moveMinX = Math.max(0, x - travel);
      platform.moveMaxX = Math.min(WIDTH - width, x + travel);
      platform.moveSpeed = 24 + difficulty * 24 + Math.random() * 10;
      platform.moveDirection = Math.random() < 0.5 ? -1 : 1;
    }
    platforms.push(platform);
    seedPlatformContents(platform, difficulty, generatedPlatformIndex);
    generatedPlatformIndex += 1;
  }
  platforms = platforms.filter((platform) => platform.y - cameraY < HEIGHT + 170);
  hazards = hazards.filter((hazard) => platforms.includes(hazard.platform));
  enemies = enemies.filter((enemy) => !enemy.removed && platforms.includes(enemy.platform));
}

function addPickup(kind: PickupKind, x: number, y: number): void {
  pickups.push({ kind, x, y, radius: kind === 'coin' ? 8 : 13, phase: Math.random() * Math.PI * 2, collected: false });
}

function addCoinTrail(platform: Platform, variant: number): void {
  const center = platform.x + platform.width / 2;
  const coinCount = randomCoinTrailCount();
  for (let i = 0; i < coinCount; i += 1) {
    const offset = (i - (coinCount - 1) / 2) * 19;
    const arcProgress = coinCount > 1 ? i / (coinCount - 1) : 0.5;
    const arc = Math.sin(arcProgress * Math.PI) * 12;
    addPickup('coin', Math.max(9, Math.min(WIDTH - 9, center + offset)), platform.y - 48 - arc - (variant % 2) * 8);
  }
}

function seedInitialPickups(): void {
  addCoinTrail(INITIAL_PLATFORMS[1], 0);
  addPickup('shield', INITIAL_PLATFORMS[2].x + INITIAL_PLATFORMS[2].width / 2, INITIAL_PLATFORMS[2].y - 54);
  addCoinTrail(INITIAL_PLATFORMS[3], 1);
}

function seedPlatformContents(platform: Platform, difficulty: number, index: number): void {
  const safeRestPlatform = index % 4 === 3;
  if (platform.kind === 'normal' && !safeRestPlatform) {
    const hazardRoll = Math.random();
    const spikeChance = 0.1 + difficulty * 0.04;
    if (hazardRoll < spikeChance) {
      const width = Math.min(42, platform.width * 0.5);
      hazards.push({ platform, x: platform.x + (platform.width - width) / 2, width, height: 18 });
    } else if (hazardRoll < spikeChance + 0.12 + difficulty * 0.04) {
      const width = 25;
      const minX = platform.x + 6;
      const maxX = platform.x + platform.width - width - 6;
      enemies.push({ platform, x: minX + Math.random() * Math.max(0, maxX - minX), y: platform.y - 23, width, height: 23, speed: 28 + difficulty * 24, direction: Math.random() < 0.5 ? -1 : 1, removed: false });
    }
  }

  const buffRoll = Math.random();
  const buffChance = safeRestPlatform ? 0 : 0.1 + difficulty * 0.04;
  if (buffRoll < buffChance) {
    const kinds: PickupKind[] = ['shield', 'rocket', 'magnet'];
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    addPickup(kind, platform.x + platform.width / 2, platform.y - 52);
  } else if (Math.random() < 0.72) {
    addCoinTrail(platform, index);
  }
}

function choosePlatformKind(difficulty: number, previousKind: PlatformKind): PlatformKind {
  // Guarantee a safe rest platform regularly, and avoid back-to-back moving/fragile jumps.
  if (generatedPlatformIndex % 4 === 3) return 'normal';
  const roll = Math.random();
  const movingChance = 0.18 + difficulty * 0.08;
  const fragileChance = 0.12 + difficulty * 0.05;
  const springChance = 0.08;
  if (roll < springChance && previousKind !== 'spring') return 'spring';
  if (roll < springChance + fragileChance && previousKind !== 'crumbling') return 'crumbling';
  if (roll < springChance + fragileChance + movingChance && previousKind !== 'moving') return 'moving';
  return 'normal';
}

function updatePlatforms(dt: number): void {
  for (const platform of platforms) {
    platform.frameDeltaX = 0;
    if (platform.kind === 'moving') {
      const oldX = platform.x;
      platform.x += (platform.moveDirection ?? 1) * (platform.moveSpeed ?? 0) * dt;
      if (platform.x <= (platform.moveMinX ?? 0)) {
        platform.x = platform.moveMinX ?? 0;
        platform.moveDirection = 1;
      } else if (platform.x >= (platform.moveMaxX ?? WIDTH - platform.width)) {
        platform.x = platform.moveMaxX ?? WIDTH - platform.width;
        platform.moveDirection = -1;
      }
      platform.frameDeltaX = platform.x - oldX;
    }
    if (platform.kind === 'crumbling' && platform.crumbleTimer !== undefined) {
      platform.crumbleTimer -= dt;
      if (platform.crumbleTimer <= 0) {
        emitParticles(platform.x + platform.width / 2, platform.y + 6, '#b98158', 8, 'debris', 30);
      }
    }
  }
  platforms = platforms.filter((platform) => platform.crumbleTimer === undefined || platform.crumbleTimer > 0);
  if (supportingPlatform?.kind === 'crumbling' && !platforms.includes(supportingPlatform)) {
    supportingPlatform = null;
    player.grounded = false;
    player.groundedFor = 0;
  }
}

function updateEnemies(dt: number): void {
  for (const enemy of enemies) {
    const minX = enemy.platform.x + 5;
    const maxX = enemy.platform.x + enemy.platform.width - enemy.width - 5;
    enemy.x += enemy.direction * enemy.speed * dt;
    if (enemy.x <= minX) {
      enemy.x = minX;
      enemy.direction = 1;
    } else if (enemy.x >= maxX) {
      enemy.x = maxX;
      enemy.direction = -1;
    }
    enemy.y = enemy.platform.y - enemy.height;
  }
}

function collectPickup(pickup: Pickup): void {
  pickup.collected = true;
  if (pickup.kind === 'coin') {
    runCoins += 1;
    void gameplayHaptic('coin');
    scorePopups.push({ x: pickup.x, y: pickup.y, text: '+25', color: '#fff0a4', life: 0.7 });
    playSound('coin');
    emitParticles(pickup.x, pickup.y, '#ffd45d', 5, 'spark', 54);
    return;
  }

  if (pickup.kind === 'shield') shieldTimer = Math.max(shieldTimer, 10);
  if (pickup.kind === 'rocket') {
    rocketTimer = Math.max(rocketTimer, 2.4);
    player.grounded = false;
    supportingPlatform = null;
    player.groundedFor = 0;
    player.vy = -720;
    player.animation = 'jump';
    jumpLight = 1;
  }
  if (pickup.kind === 'magnet') magnetTimer = Math.max(magnetTimer, 12);
  void gameplayHaptic('powerup');
  playSound('buff');
  emitParticles(pickup.x, pickup.y, pickup.kind === 'shield' ? '#70d7ff' : pickup.kind === 'rocket' ? '#ff9d55' : '#ff4f70', 12, 'spark', 110);
}

function updatePickups(dt: number): void {
  const playerX = player.x + PHYSICS.playerWidth / 2;
  const playerY = player.y + PHYSICS.playerHeight * 0.48;
  for (const pickup of pickups) {
    pickup.phase += dt * 4;
    if (pickup.kind === 'coin' && magnetTimer > 0) {
      const dx = playerX - pickup.x;
      const dy = playerY - pickup.y;
      const distance = Math.hypot(dx, dy);
      if (distance < 180 && distance > 1) {
        const pull = Math.min(620, 180 + (180 - distance) * 3.2) * dt;
        pickup.x += dx / distance * pull;
        pickup.y += dy / distance * pull;
      }
    }
    const dx = playerX - pickup.x;
    const dy = playerY - pickup.y;
    const collectionReach = pickup.radius + (pickup.kind === 'coin' ? 25 : 17);
    if (Math.hypot(dx, dy) < collectionReach) collectPickup(pickup);
  }
  pickups = pickups.filter((pickup) => !pickup.collected && pickup.y - cameraY < HEIGHT + 130);
}

function damagePlayer(x: number, y: number): void {
  if (invulnerableTimer > 0 || rocketTimer > 0) return;
  playSound('hit');
  void gameplayHaptic('hit');
  if (shieldTimer > 0) {
    shieldTimer = 0;
    invulnerableTimer = 1.25;
    player.grounded = false;
    supportingPlatform = null;
    player.groundedFor = 0;
    player.vy = -PHYSICS.jumpVelocity * 0.78;
    jumpLight = 0.75;
    emitParticles(x, y, '#8de3ff', 16, 'spark', 150);
    return;
  }
  finishGame('hazard');
}

function resolveHazards(previousBottom: number, wasFalling: boolean): void {
  if (invulnerableTimer > 0 || rocketTimer > 0) return;
  const left = player.x + 5;
  const right = player.x + PHYSICS.playerWidth - 5;
  const feetBottom = player.y + PHYSICS.playerHeight;

  for (const hazard of hazards) {
    const hazardTop = hazard.platform.y - hazard.height;
    const landingOnHazard = isLandingOnHazard({
      wasFalling,
      previousBottom,
      currentBottom: feetBottom,
      hazardTop,
      playerLeft: left,
      playerRight: right,
      hazardLeft: hazard.x,
      hazardRight: hazard.x + hazard.width,
    });
    if (landingOnHazard) {
      damagePlayer(player.x + PHYSICS.playerWidth / 2, hazardTop + hazard.height / 2);
      if (lost) return;
    }
  }

  for (const enemy of enemies) {
    if (enemy.removed) continue;
    const overlaps = right > enemy.x + 2 && left < enemy.x + enemy.width - 2 &&
      player.y + PHYSICS.playerHeight > enemy.y + 2 && player.y < enemy.y + enemy.height;
    if (!overlaps) continue;
    const wasAbove = wasFalling && previousBottom <= enemy.y + enemy.height;
    const nowAbove = player.y + PHYSICS.playerHeight * 0.7 < enemy.y + enemy.height * 0.56;
    if (wasAbove && nowAbove) {
      enemy.removed = true;
      runCoins += 2;
      void gameplayHaptic('stomp');
      scorePopups.push({ x: enemy.x + enemy.width / 2, y: enemy.y, text: '+50', color: '#ffe39a', life: 0.85 });
      playSound('stomp');
      player.grounded = false;
      supportingPlatform = null;
      player.groundedFor = 0;
      player.vy = -PHYSICS.jumpVelocity * 0.58;
      emitParticles(enemy.x + enemy.width / 2, enemy.y + enemy.height / 2, '#ffca6a', 12, 'spark', 106);
    } else {
      damagePlayer(player.x + PHYSICS.playerWidth / 2, enemy.y + enemy.height / 2);
      if (lost) return;
    }
  }
}

function update(dt: number): void {
  if (!started || paused || lost) return;
  shieldTimer = Math.max(0, shieldTimer - dt);
  rocketTimer = Math.max(0, rocketTimer - dt);
  magnetTimer = Math.max(0, magnetTimer - dt);
  invulnerableTimer = Math.max(0, invulnerableTimer - dt);
  updatePlatforms(dt);
  updateEnemies(dt);
  const previousPlayerBottom = player.y + PHYSICS.playerHeight;
  const wasFalling = player.vy >= 0;
  if (tiltEnabled && latestGamma !== null) {
    const delta = latestGamma - tiltCenter;
    const normalized = Math.abs(delta) < 3 ? 0 : Math.max(-1, Math.min(1, delta / 22));
    targetTilt = normalized;
  } else {
    targetTilt = 0;
  }
  smoothTilt += (targetTilt - smoothTilt) * (1 - Math.exp(-dt * 7));
  const input = horizontalInput();
  const target = input * PHYSICS.maxSpeed;
  if (input !== 0) {
    player.vx += Math.sign(target - player.vx) * Math.min(Math.abs(target - player.vx), PHYSICS.acceleration * dt);
    player.facing = input > 0 ? 1 : -1;
  } else {
    player.vx += Math.sign(-player.vx) * Math.min(Math.abs(player.vx), PHYSICS.deceleration * dt);
  }

  player.x += player.vx * dt;
  if (player.x + PHYSICS.playerWidth < 0) player.x = WIDTH;
  else if (player.x > WIDTH) player.x = -PHYSICS.playerWidth;

  if (player.grounded && supportingPlatform?.kind === 'moving') {
    player.x += supportingPlatform.frameDeltaX ?? 0;
  }

  if (player.grounded && supportingPlatform) {
    const inset = supportingPlatform.width * 0.06;
    const playerCenter = player.x + PHYSICS.playerWidth / 2;
    if (playerCenter <= supportingPlatform.x + inset || playerCenter >= supportingPlatform.x + supportingPlatform.width - inset) {
      player.grounded = false;
      supportingPlatform = null;
      player.groundedFor = 0;
    }
  }

  if (player.grounded) {
    player.groundedFor += dt;
    player.animation = input === 0 ? 'idle' : (keys.has('shift') ? 'run' : 'walk');
    if (Math.abs(input) > 0.2 && supportingPlatform) {
      footstepDustClock += dt;
      if (footstepDustClock >= 0.16) {
        footstepDustClock = 0;
        emitParticles(player.x + PHYSICS.playerWidth / 2, player.y + PHYSICS.playerHeight, '#e7d0a9', 2, 'dust', 24);
      }
    } else {
      footstepDustClock = 0;
    }
    if (player.groundedFor >= PHYSICS.autoJumpDelay) {
      const launchingPlatform = supportingPlatform;
      const springJump = launchingPlatform?.kind === 'spring';
      player.vy = -(springJump ? PHYSICS.jumpVelocity * 1.16 : PHYSICS.jumpVelocity);
      playSound(springJump ? 'spring' : 'jump');
      jumpLight = springJump ? 1 : 0.2;
      emitParticles(player.x + PHYSICS.playerWidth / 2, launchingPlatform?.y ?? player.y + PHYSICS.playerHeight, springJump ? '#fff0a8' : '#ead7b4', springJump ? 10 : 5, springJump ? 'spark' : 'dust', springJump ? 112 : 58);
      player.grounded = false;
      supportingPlatform = null;
      player.animation = 'jump';
    }
  } else if (rocketTimer > 0) {
    player.vy = -720;
    player.y += player.vy * dt;
    player.animation = 'jump';
    rocketTrailClock += dt;
    if (rocketTrailClock >= 0.08) {
      rocketTrailClock = 0;
      emitParticles(player.x + PHYSICS.playerWidth / 2, player.y + PHYSICS.playerHeight - 7, '#ffae59', 3, 'spark', 40);
    }
  } else {
    player.vy += PHYSICS.gravity * dt;
    player.y += player.vy * dt;
    if (player.vy >= 0) {
      const currentBottom = player.y + PHYSICS.playerHeight;
      const platform = platforms.find((candidate) => {
        const inset = candidate.width * 0.06;
        const playerCenter = player.x + PHYSICS.playerWidth / 2;
        return previousPlayerBottom <= candidate.y && currentBottom >= candidate.y &&
          candidate.y - cameraY <= HEIGHT &&
          playerCenter > candidate.x + inset && playerCenter < candidate.x + candidate.width - inset;
      });
      if (platform) {
        player.y = platform.y - PHYSICS.playerHeight;
        player.vy = 0;
        player.grounded = true;
        supportingPlatform = platform;
        player.groundedFor = 0;
        if (platform.kind === 'crumbling' && platform.crumbleTimer === undefined) platform.crumbleTimer = 0.88;
        playSound(platform.kind === 'spring' ? 'spring' : 'land');
        emitParticles(player.x + PHYSICS.playerWidth / 2, platform.y, platform.kind === 'spring' ? '#d8f5ae' : '#e9d3ad', platform.kind === 'spring' ? 9 : 6, platform.kind === 'spring' ? 'spark' : 'dust', 74);
        player.animation = input === 0 ? 'idle' : (keys.has('shift') ? 'run' : 'walk');
        void gameplayHaptic('landing');
      } else {
        player.animation = player.vy < 0 ? 'jump' : 'fall';
      }
    } else {
      player.animation = 'jump';
    }
  }

  updatePickups(dt);
  resolveHazards(previousPlayerBottom, wasFalling);

  if (player.y < peakPlayerY) {
    peakPlayerY = player.y;
    const altitude = Math.max(0, Math.floor((START_Y - peakPlayerY) / 2));
    if (altitude > recordMeters) {
      recordMeters = altitude;
      void saveBestAltitude(recordMeters);
    }
  }
  // Keep the current landing platform inside the view during a normal jump.
  const cameraTarget = player.y - HEIGHT * 0.32;
  if (cameraTarget < cameraY) cameraY = cameraTarget;
  ensurePlatformsAhead();

  if (!lost && player.y + PHYSICS.playerHeight - cameraY >= HEIGHT) {
    finishGame('fall');
  }
  scorePopups = scorePopups.filter((popup) => {
    popup.life -= dt;
    popup.y -= 20 * dt;
    return popup.life > 0;
  });
  updateParticles(dt);
  jumpLight = Math.max(0, jumpLight - dt * 1.7);
}

function cloudPath(x: number, y: number, size: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, size * 0.62, size * 0.2, 0, 0, Math.PI * 2);
  ctx.ellipse(x - size * 0.27, y - size * 0.06, size * 0.27, size * 0.18, 0, 0, Math.PI * 2);
  ctx.ellipse(x + size * 0.08, y - size * 0.13, size * 0.31, size * 0.25, 0, 0, Math.PI * 2);
  ctx.ellipse(x + size * 0.35, y - size * 0.04, size * 0.24, size * 0.16, 0, 0, Math.PI * 2);
}

function drawCloud(x: number, y: number, size: number, alpha = 1): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = 'rgba(98, 125, 151, 0.16)';
  cloudPath(x, y + size * 0.08, size);
  ctx.fill();
  const cloud = ctx.createLinearGradient(0, y - size * 0.35, 0, y + size * 0.25);
  cloud.addColorStop(0, 'rgba(255, 253, 246, 0.96)');
  cloud.addColorStop(0.56, 'rgba(249, 245, 231, 0.9)');
  cloud.addColorStop(1, 'rgba(227, 218, 204, 0.76)');
  ctx.fillStyle = cloud;
  cloudPath(x, y, size);
  ctx.fill();
  ctx.restore();
}

function drawArch(x: number, y: number, width: number, height: number, color: string): void {
  ctx.fillStyle=color; ctx.beginPath(); ctx.moveTo(x,y+height); ctx.lineTo(x,y+width*0.58);
  ctx.arc(x+width/2,y+width*0.58,width/2,Math.PI,0,false); ctx.lineTo(x+width,y+height); ctx.closePath(); ctx.fill();
}

function drawCityLayer(offset: number, color: string, layer: number): void {
  const step=layer===0?98:layer===1?82:68, shift=((offset%step)+step)%step;
  for(let i=-2;i<Math.ceil(WIDTH/step)+2;i++){
    const seed=Math.abs(Math.sin((i+layer*17)*12.9898)*43758.5453)%1, x=i*step-shift, width=step*(0.72+seed*0.18);
    const height=118+seed*(layer===0?108:158), base=HEIGHT+14+offset*(0.08+layer*0.035), top=base-height;
    const shade=layer===0?'#9fb4c0':layer===1?'#d4b995':'#e6c79f', facade=ctx.createLinearGradient(x,top,x+width,top+height);
    facade.addColorStop(0,shade); facade.addColorStop(0.55,color); facade.addColorStop(1,layer===0?'#879eae':'#c99d70');
    ctx.fillStyle=facade; ctx.fillRect(x,top+15,width,height);
    ctx.fillStyle=layer===0?'rgba(151,169,182,0.7)':'rgba(239,213,169,0.94)'; ctx.fillRect(x-4,top+13,width+8,7); ctx.fillRect(x+4,top+5,width-8,9);
    if(seed>0.55){ctx.beginPath();ctx.ellipse(x+width*.5,top+16,width*.3,15+seed*8,Math.PI,0,Math.PI);ctx.fill();ctx.fillRect(x+width*.2,top+16,width*.6,12);}
    for(let floor=0;floor<Math.max(1,Math.floor(height/58));floor++){
      const wy=top+34+floor*48;
      for(let col=0;col<2;col++){
        const wx=x+12+col*(width*.42); if(wx+16>=x+width)continue;
        drawArch(wx,wy,15,27,layer===0?'rgba(89,117,139,0.44)':'rgba(87,105,117,0.48)');
        ctx.fillStyle='rgba(247,222,177,0.27)';ctx.fillRect(wx+3,wy+13,9,2);
      }
    }
    if(layer>0&&i%3===0){
      ctx.fillStyle='rgba(135,83,55,0.7)';ctx.fillRect(x+width*.24,top+23,3,height-28);ctx.fillRect(x+width*.72,top+23,3,height-28);
      ctx.fillStyle='rgba(190,105,70,0.74)';ctx.beginPath();ctx.moveTo(x+width*.24,top+48);ctx.lineTo(x+width*.47,top+54);ctx.lineTo(x+width*.45,top+98);ctx.lineTo(x+width*.24,top+88);ctx.closePath();ctx.fill();
    }
  }
}

function drawPalm(x: number, base: number, scale: number, offset: number): void {
  const sway = offset * 0.12;
  const crownX = x + sway;
  const crownY = base - 92 * scale;
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(132,91,59,0.78)';
  ctx.lineWidth = 9 * scale;
  ctx.beginPath();
  ctx.moveTo(x, base);
  ctx.quadraticCurveTo(x + 10 * scale + sway * 0.35, base - 48 * scale, crownX, crownY);
  ctx.stroke();
  const greens = ['#557f58', '#668c5e', '#789962'];
  for (let i = 0; i < 7; i += 1) {
    const angle = -Math.PI + 0.18 + i * (Math.PI - 0.36) / 6;
    const length = (43 + (i % 3) * 5) * scale;
    const ex = crownX + Math.cos(angle) * length;
    const ey = crownY + Math.sin(angle) * length * 0.72;
    ctx.fillStyle = greens[i % greens.length];
    ctx.beginPath();
    ctx.moveTo(crownX, crownY);
    ctx.quadraticCurveTo(crownX + Math.cos(angle - 0.3) * length * 0.7, crownY + Math.sin(angle - 0.3) * length * 0.8, ex, ey);
    ctx.quadraticCurveTo(crownX + Math.cos(angle + 0.18) * length * 0.35, crownY + Math.sin(angle + 0.18) * length * 0.25, crownX, crownY);
    ctx.fill();
  }
}

function drawMinaret(offset: number): void {
  const base = HEIGHT + 20 + offset * 0.1;
  ctx.fillStyle = 'rgba(164,149,150,0.28)';
  ctx.fillRect(168, base - 230, 23, 230);
  ctx.fillRect(163, base - 208, 33, 8);
  ctx.fillRect(166, base - 178, 27, 7);
  ctx.fillRect(163, base - 208, 33, 8);
  ctx.beginPath();
  ctx.moveTo(164, base - 230);
  ctx.lineTo(179.5, base - 259);
  ctx.lineTo(195, base - 230);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(175, base - 276, 9, 18);
  ctx.beginPath();
  ctx.arc(179.5, base - 280, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(94,120,142,0.34)';
  ctx.fillRect(176, base - 196, 7, 20);
  ctx.fillRect(176, base - 164, 7, 20);
  ctx.fillRect(176, base - 132, 7, 20);
}

function drawDistantRidges(rise: number, alpha: number): void {
  for (let layer = 0; layer < 2; layer += 1) {
    const drift = rise * (layer === 0 ? 0.035 : 0.065);
    const base = HEIGHT + 40 + drift;
    const shift = ((rise * (layer === 0 ? 0.025 : 0.045)) % 170);
    ctx.fillStyle = layer === 0 ? `rgba(101, 132, 156, ${0.2 * alpha})` : `rgba(133, 157, 170, ${0.24 * alpha})`;
    ctx.beginPath();
    ctx.moveTo(-180, base);
    for (let x = -180; x <= WIDTH + 180; x += 170) {
      const peak = 48 + (Math.sin((x + layer * 61) * 0.035) + 1) * (layer === 0 ? 28 : 43);
      ctx.quadraticCurveTo(x + 55 - shift, base - peak, x + 110 - shift, base - peak * 0.42);
      ctx.quadraticCurveTo(x + 142 - shift, base - peak * 0.2, x + 170 - shift, base);
    }
    ctx.lineTo(WIDTH + 180, HEIGHT + 80);
    ctx.lineTo(-180, HEIGHT + 80);
    ctx.closePath();
    ctx.fill();
  }
}

function drawBackground(): void {
  const rise = Math.max(0, -cameraY);
  const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
  const cityFadeRaw = clamp01(1 - rise / 1120);
  const cityFade = cityFadeRaw * cityFadeRaw * (3 - 2 * cityFadeRaw);
  const highAltitude = clamp01((rise - 720) / 1900);
  const sky = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  sky.addColorStop(0, '#5b8fbe');
  sky.addColorStop(0.42, '#89b5d6');
  sky.addColorStop(0.74, '#c7d2d6');
  sky.addColorStop(1, '#ead2ae');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const altitudeTint = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  altitudeTint.addColorStop(0, `rgba(19, 43, 83, ${0.34 * highAltitude})`);
  altitudeTint.addColorStop(0.62, `rgba(43, 77, 120, ${0.2 * highAltitude})`);
  altitudeTint.addColorStop(1, `rgba(83, 117, 151, ${0.07 * highAltitude})`);
  ctx.fillStyle = altitudeTint;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const sun = ctx.createRadialGradient(WIDTH * 0.76, HEIGHT * 0.16, 4, WIDTH * 0.76, HEIGHT * 0.16, WIDTH * 0.82);
  sun.addColorStop(0, `rgba(255, 245, 207, ${0.34 * (1 - highAltitude * 0.7)})`);
  sun.addColorStop(0.36, `rgba(255, 232, 185, ${0.12 * (1 - highAltitude)})`);
  sun.addColorStop(1, 'rgba(255, 232, 185, 0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const clouds = [
    { x: 22, y: 148, size: 60, speed: 0.12, drift: 0.012, opacity: 0.7 },
    { x: 286, y: 208, size: 74, speed: 0.085, drift: -0.016, opacity: 0.78 },
    { x: 166, y: 330, size: 38, speed: 0.17, drift: 0.025, opacity: 0.54 },
    { x: 54, y: 432, size: 35, speed: 0.11, drift: -0.02, opacity: 0.64 },
    { x: 245, y: 66, size: 42, speed: 0.055, drift: 0.01, opacity: 0.48 },
  ];
  for (const cloud of clouds) {
    const spanX = WIDTH + cloud.size * 2;
    const wrappedX = (((cloud.x + rise * cloud.drift + cloud.size) % spanX) + spanX) % spanX - cloud.size;
    const spanY = HEIGHT + 140;
    const wrappedY = (((cloud.y + rise * cloud.speed + 70) % spanY) + spanY) % spanY - 70;
    drawCloud(wrappedX, wrappedY, cloud.size, cloud.opacity * (1 - highAltitude * 0.3));
  }

  drawDistantRidges(rise, cityFade);
  ctx.save();
  ctx.globalAlpha = cityFade;
  drawCityLayer(rise * 0.12, 'rgba(183,194,199,0.45)', 0);
  drawMinaret(rise * 0.18);
  drawCityLayer(rise * 0.31, 'rgba(204,174,139,0.66)', 1);
  drawCityLayer(rise * 0.58, 'rgba(227,196,153,0.9)', 2);
  drawPalm(24, HEIGHT + 15 + rise * 0.58, 1.04, rise * 0.4);
  drawPalm(WIDTH - 21, HEIGHT + 18 + rise * 0.72, 0.88, rise * 0.55);
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = cityFade * 0.82;
  ctx.strokeStyle = 'rgba(50, 74, 99, 0.68)';
  ctx.lineWidth = 2;
  for (const [x, y] of [[92, 256], [116, 267], [139, 252]] as const) {
    const driftX = (((x + rise * 0.045) % (WIDTH + 24)) + WIDTH + 24) % (WIDTH + 24) - 12;
    const driftY = y + rise * 0.06;
    ctx.beginPath();
    ctx.moveTo(driftX - 7, driftY + 3);
    ctx.quadraticCurveTo(driftX, driftY - 4, driftX + 7, driftY + 3);
    ctx.stroke();
  }
  ctx.restore();

  const haze = ctx.createLinearGradient(0, HEIGHT - 190, 0, HEIGHT);
  haze.addColorStop(0, 'rgba(195,203,205,0)');
  haze.addColorStop(1, `rgba(201,191,171,${0.28 * cityFade})`);
  ctx.fillStyle = haze;
  ctx.fillRect(0, HEIGHT - 190, WIDTH, 190);

  const starFade = clamp01((rise - 880) / 1550);
  if (starFade > 0) {
    ctx.save();
    for (let i = 0; i < 54; i += 1) {
      const x = (i * 73.7 + 13) % WIDTH;
      const y = ((i * 97.3 + rise * (0.025 + (i % 3) * 0.009)) % HEIGHT + HEIGHT) % HEIGHT;
      const twinkle = 0.42 + 0.58 * (0.5 + 0.5 * Math.sin(animationClock * 0.0014 + i * 1.7));
      ctx.globalAlpha = starFade * twinkle;
      ctx.fillStyle = i % 5 === 0 ? '#fff0c9' : '#f3f7ff';
      ctx.beginPath();
      ctx.arc(x, y, i % 4 === 0 ? 1.2 : 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  const vignette = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, HEIGHT * 0.22, WIDTH / 2, HEIGHT / 2, HEIGHT * 0.78);
  vignette.addColorStop(0, 'rgba(18, 31, 50, 0)');
  vignette.addColorStop(1, `rgba(18, 31, 50, ${0.2 + highAltitude * 0.08})`);
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

function drawPlatform(platform: Platform, index: number): void {
  const screenY = platform.y - cameraY;
  if (platformArt.complete && platformArt.naturalWidth > 0) {
    const artHeight = platform.width * platformArt.naturalHeight / platformArt.naturalWidth;
    const artTop = screenY - artHeight * 2 / platformArt.naturalHeight;
    ctx.drawImage(platformArt, platform.x, artTop, platform.width, artHeight);
  } else {
    ctx.fillStyle = '#1a1923';
    ctx.beginPath();
    ctx.roundRect(platform.x, screenY + 5, platform.width, platform.height, 5);
    ctx.fill();
    ctx.fillStyle = index === 0 ? '#d2a66f' : '#c8b38f';
    ctx.beginPath();
    ctx.roundRect(platform.x, screenY, platform.width, platform.height, 5);
    ctx.fill();
    ctx.fillStyle = '#f2d7a6';
    ctx.fillRect(platform.x + 8, screenY + 2, platform.width - 16, 2);
  }

  const center = platform.x + platform.width / 2;
  if (platform.kind === 'moving') {
    ctx.strokeStyle = 'rgba(104, 211, 224, 0.92)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(center - 12, screenY + 8);
    ctx.lineTo(center + 12, screenY + 8);
    ctx.moveTo(center - 12, screenY + 8);
    ctx.lineTo(center - 7, screenY + 5);
    ctx.moveTo(center + 12, screenY + 8);
    ctx.lineTo(center + 7, screenY + 5);
    ctx.stroke();
  } else if (platform.kind === 'crumbling') {
    ctx.strokeStyle = 'rgba(84, 56, 43, 0.88)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(center - 8, screenY + 3);
    ctx.lineTo(center - 3, screenY + 7);
    ctx.lineTo(center - 6, screenY + 11);
    ctx.moveTo(center + 7, screenY + 4);
    ctx.lineTo(center + 3, screenY + 8);
    ctx.lineTo(center + 6, screenY + 12);
    ctx.stroke();
  } else if (platform.kind === 'spring') {
    ctx.strokeStyle = 'rgba(100, 202, 119, 0.96)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(center - 10, screenY + 8);
    ctx.lineTo(center - 6, screenY + 4);
    ctx.lineTo(center - 2, screenY + 8);
    ctx.lineTo(center + 2, screenY + 4);
    ctx.lineTo(center + 6, screenY + 8);
    ctx.lineTo(center + 10, screenY + 4);
    ctx.stroke();
  }
}

function drawPowerupIcon(kind: Exclude<PickupKind, 'coin'>, x: number, y: number, size: number, color: string): void {
  ctx.save();
  ctx.lineWidth = Math.max(1.5, size * 0.2);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  if (kind === 'shield') {
    ctx.beginPath();
    ctx.moveTo(x, y - size);
    ctx.lineTo(x + size * 0.78, y - size * 0.58);
    ctx.lineTo(x + size * 0.62, y + size * 0.34);
    ctx.lineTo(x, y + size);
    ctx.lineTo(x - size * 0.62, y + size * 0.34);
    ctx.lineTo(x - size * 0.78, y - size * 0.58);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y - size * 0.55);
    ctx.lineTo(x, y + size * 0.55);
    ctx.stroke();
  } else if (kind === 'rocket') {
    ctx.translate(x, y);
    ctx.rotate(-0.38);
    ctx.beginPath();
    ctx.moveTo(0, -size * 1.18);
    ctx.quadraticCurveTo(size * 0.72, -size * 0.55, size * 0.52, size * 0.42);
    ctx.lineTo(-size * 0.52, size * 0.42);
    ctx.quadraticCurveTo(-size * 0.72, -size * 0.55, 0, -size * 1.18);
    ctx.fill();
    ctx.fillStyle = '#fff1d0';
    ctx.beginPath();
    ctx.arc(0, -size * 0.24, size * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff9b4a';
    ctx.beginPath();
    ctx.moveTo(-size * 0.34, size * 0.35);
    ctx.lineTo(-size * 0.8, size * 0.9);
    ctx.lineTo(-size * 0.17, size * 0.68);
    ctx.moveTo(size * 0.34, size * 0.35);
    ctx.lineTo(size * 0.8, size * 0.9);
    ctx.lineTo(size * 0.17, size * 0.68);
    ctx.fill();
  } else {
    ctx.shadowColor = '#ff3e65';
    ctx.shadowBlur = size * 0.9;
    ctx.lineWidth = Math.max(2.5, size * 0.42);
    ctx.strokeStyle = '#fff6e7';
    ctx.beginPath();
    ctx.moveTo(-size * 0.68, -size * 0.58);
    ctx.lineTo(-size * 0.68, size * 0.18);
    ctx.quadraticCurveTo(-size * 0.68, size * 0.82, 0, size * 0.82);
    ctx.quadraticCurveTo(size * 0.68, size * 0.82, size * 0.68, size * 0.18);
    ctx.lineTo(size * 0.68, -size * 0.58);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(1.5, size * 0.23);
    ctx.strokeStyle = '#ff3f64';
    ctx.beginPath();
    ctx.moveTo(-size * 0.68, -size * 0.52);
    ctx.lineTo(-size * 0.68, size * 0.16);
    ctx.quadraticCurveTo(-size * 0.68, size * 0.69, 0, size * 0.69);
    ctx.quadraticCurveTo(size * 0.68, size * 0.69, size * 0.68, size * 0.16);
    ctx.lineTo(size * 0.68, -size * 0.52);
    ctx.stroke();
    ctx.fillStyle = '#65e4ff';
    ctx.fillRect(-size * 0.96, -size * 0.88, size * 0.56, size * 0.42);
    ctx.fillStyle = '#ffe36e';
    ctx.fillRect(size * 0.4, -size * 0.88, size * 0.56, size * 0.42);
  }
  ctx.restore();
}

function drawHazard(hazard: Hazard): void {
  const y = hazard.platform.y - cameraY;
  const spikeCount = Math.max(2, Math.floor(hazard.width / 13));
  const spikeWidth = hazard.width / spikeCount;
  ctx.save();
  ctx.shadowColor = 'rgba(247, 102, 73, 0.45)';
  ctx.shadowBlur = 6;
  for (let i = 0; i < spikeCount; i += 1) {
    const left = hazard.x + i * spikeWidth;
    ctx.fillStyle = i % 2 === 0 ? '#c85b48' : '#a84940';
    ctx.strokeStyle = '#663b39';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(left + spikeWidth / 2, y - hazard.height);
    ctx.lineTo(left + spikeWidth, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 225, 190, 0.62)';
    ctx.beginPath();
    ctx.moveTo(left + spikeWidth * 0.2, y - 3);
    ctx.lineTo(left + spikeWidth / 2, y - hazard.height + 4);
    ctx.stroke();
  }
  ctx.restore();
}

function drawEnemy(enemy: Enemy): void {
  if (enemy.removed) return;
  const y = enemy.y - cameraY;
  ctx.save();
  ctx.fillStyle = 'rgba(36, 35, 39, 0.24)';
  ctx.beginPath();
  ctx.ellipse(enemy.x + enemy.width / 2, y + enemy.height + 2, enemy.width * 0.62, 3.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#74473c';
  ctx.beginPath();
  ctx.roundRect(enemy.x + 2, y + 8, enemy.width - 4, enemy.height - 7, 7);
  ctx.fill();
  ctx.fillStyle = '#bd6749';
  ctx.beginPath();
  ctx.roundRect(enemy.x, y + 7, enemy.width, enemy.height - 10, 7);
  ctx.fill();
  ctx.fillStyle = '#493b3b';
  ctx.beginPath();
  ctx.arc(enemy.x + enemy.width / 2, y + 8, enemy.width * 0.48, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(enemy.x + 2, y + 7, enemy.width - 4, 4);
  ctx.fillStyle = '#f5e5bb';
  ctx.fillRect(enemy.x + 5, y + 13, 5, 3);
  ctx.fillRect(enemy.x + enemy.width - 10, y + 13, 5, 3);
  ctx.fillStyle = '#292c34';
  ctx.fillRect(enemy.x + 7, y + 13, 2, 3);
  ctx.fillRect(enemy.x + enemy.width - 8, y + 13, 2, 3);
  ctx.fillStyle = '#4e3937';
  ctx.fillRect(enemy.x + 3, y + enemy.height - 5, 7, 5);
  ctx.fillRect(enemy.x + enemy.width - 10, y + enemy.height - 5, 7, 5);
  ctx.restore();
}

function drawPickup(pickup: Pickup): void {
  if (pickup.collected) return;
  const y = pickup.y - cameraY + Math.sin(pickup.phase) * 3;
  const color = pickup.kind === 'coin' ? '#ffcf4f' : pickup.kind === 'shield' ? '#64cefa' : pickup.kind === 'rocket' ? '#ff9150' : '#ff4f70';
  ctx.save();
  const glow = ctx.createRadialGradient(pickup.x, y, 1, pickup.x, y, pickup.radius * 2.3);
  glow.addColorStop(0, `${color}${pickup.kind === 'magnet' ? 'd8' : '80'}`);
  glow.addColorStop(1, `${color}00`);
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(pickup.x, y, pickup.radius * 2.3, 0, Math.PI * 2);
  ctx.fill();
  if (pickup.kind === 'coin') {
    const spin = 0.28 + Math.abs(Math.cos(animationClock * 0.006 + pickup.phase)) * 0.72;
    ctx.fillStyle = '#d28a25';
    ctx.beginPath();
    ctx.ellipse(pickup.x, y, pickup.radius * spin, pickup.radius * 1.25, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff0a1';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.ellipse(pickup.x, y, pickup.radius * spin * 0.7, pickup.radius * 0.92, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#fff4bb';
    ctx.fillRect(pickup.x - pickup.radius * 0.12, y - pickup.radius * 0.6, Math.max(1, pickup.radius * spin * 0.22), pickup.radius * 0.5);
  } else {
    ctx.fillStyle = pickup.kind === 'magnet' ? 'rgba(24, 34, 49, 0.98)' : 'rgba(32, 47, 65, 0.82)';
    ctx.beginPath();
    ctx.arc(pickup.x, y, pickup.radius + (pickup.kind === 'magnet' ? 4 : 3), 0, Math.PI * 2);
    ctx.fill();
    if (pickup.kind === 'magnet') {
      ctx.strokeStyle = '#ffd776';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(pickup.x, y, pickup.radius + 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    drawPowerupIcon(pickup.kind, pickup.x, y, pickup.radius * 0.78, color);
  }
  ctx.restore();
}

function drawPlayer(now: number): void {
  const set = animations[player.animation];
  const ready = set.image.complete && set.image.naturalWidth > 0;
  const rawFrame = Math.floor(now * set.fps / 1000) % set.count;
  let frame = rawFrame;
  if (player.animation === 'fall') frame = 3 - (rawFrame % 2);
  const frameSize = 128;
  const drawSize = frameSize * 0.8;
  const screenY = player.y - cameraY;
  const centerX = player.x + PHYSICS.playerWidth / 2;
  if (shieldTimer > 0) {
    const pulse = 0.42 + Math.sin(animationClock * 0.008) * 0.12;
    ctx.strokeStyle = `rgba(111, 216, 255, ${pulse})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(centerX, screenY + 31, 29, 39, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (player.grounded) {
    const shadow = ctx.createRadialGradient(centerX, screenY + PHYSICS.playerHeight, 1, centerX, screenY + PHYSICS.playerHeight, 35);
    shadow.addColorStop(0, 'rgba(31, 36, 39, 0.28)');
    shadow.addColorStop(1, 'rgba(31, 36, 39, 0)');
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.ellipse(centerX, screenY + PHYSICS.playerHeight, 35, 9, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const glow = ctx.createRadialGradient(centerX, screenY + 36, 2, centerX, screenY + 36, 52);
    glow.addColorStop(0, `rgba(255, 235, 181, ${0.13 + jumpLight * 0.16})`);
    glow.addColorStop(0.55, `rgba(255, 217, 143, ${0.06 + jumpLight * 0.08})`);
    glow.addColorStop(1, 'rgba(255, 217, 143, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(centerX - 54, screenY - 18, 108, 108);
  }
  if (ready) {
    ctx.save();
    if (invulnerableTimer > 0 && Math.floor(animationClock / 75) % 2 === 0) ctx.globalAlpha = 0.45;
    if (player.facing < 0) {
      ctx.translate(player.x + PHYSICS.playerWidth / 2, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(set.image, frame * frameSize, 0, frameSize, frameSize, -drawSize / 2, screenY + PHYSICS.playerHeight - drawSize, drawSize, drawSize);
    } else {
      ctx.drawImage(set.image, frame * frameSize, 0, frameSize, frameSize, player.x + PHYSICS.playerWidth / 2 - drawSize / 2, screenY + PHYSICS.playerHeight - drawSize, drawSize, drawSize);
    }
    ctx.restore();
  }
}

function drawHud(): void {
  const altitude = Math.max(0, Math.floor((START_Y - peakPlayerY) / 2));
  const record = Math.max(recordMeters, altitude);
  ctx.save(); ctx.lineJoin = 'round'; ctx.textBaseline = 'top'; ctx.font = '900 12px system-ui';
  ctx.lineWidth = 3; ctx.strokeStyle = '#25384f'; ctx.fillStyle = '#fffaf0';
  ctx.strokeText('ALTURA',18,10); ctx.fillText('ALTURA',18,10);
  ctx.font = '900 25px system-ui'; ctx.lineWidth = 4;
  ctx.strokeText(String(altitude)+' m',18,25); ctx.fillText(String(altitude)+' m',18,25);
  const scoreLabel = scoreFor(altitude) >= 10000 ? `${(scoreFor(altitude) / 1000).toFixed(1)}k` : String(scoreFor(altitude));
  ctx.textAlign = 'left'; ctx.font = '900 10px system-ui'; ctx.lineWidth = 2.5;
  ctx.strokeText(`PTS ${scoreLabel}`,18,61); ctx.fillText(`PTS ${scoreLabel}`,18,61);
  ctx.textAlign = 'right'; ctx.font = '900 12px system-ui'; ctx.strokeText('RECORDE',290,10); ctx.fillText('RECORDE',290,10);
  ctx.font = '900 25px system-ui'; ctx.strokeText(String(record)+' m',290,25); ctx.fillText(String(record)+' m',290,25);
  ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(40,67,97,0.82)'; ctx.beginPath(); ctx.roundRect(316,8,34,30,7); ctx.fill();
  ctx.fillStyle = '#f8f7ee'; ctx.fillRect(326,15,5,16); ctx.fillRect(336,15,5,16);

  ctx.fillStyle = 'rgba(40,67,97,0.82)';
  ctx.beginPath(); ctx.roundRect(277, 58, 66, 38, 9); ctx.fill();
  ctx.fillStyle = '#ffd15d'; ctx.beginPath(); ctx.arc(291, 77, 7, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#fff0a1'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(291, 77, 4.5, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#fffaf0'; ctx.font = '900 13px system-ui'; ctx.fillText(String(runCoins), 303, 69);

  const activeBuffs: { kind: Exclude<PickupKind, 'coin'>; time: number; color: string }[] = [];
  if (shieldTimer > 0) activeBuffs.push({ kind: 'shield', time: shieldTimer, color: '#64cefa' });
  if (rocketTimer > 0) activeBuffs.push({ kind: 'rocket', time: rocketTimer, color: '#ff9150' });
  if (magnetTimer > 0) activeBuffs.push({ kind: 'magnet', time: magnetTimer, color: '#ff4f70' });
  activeBuffs.forEach((buff, index) => {
    const x = 83 + index * 47;
    ctx.fillStyle = 'rgba(33, 50, 72, 0.86)';
    ctx.beginPath(); ctx.roundRect(x, 59, 42, 31, 9); ctx.fill();
    drawPowerupIcon(buff.kind, x + 15, 74.5, 8, buff.color);
    ctx.fillStyle = '#f7f4eb'; ctx.font = '800 9px system-ui'; ctx.textAlign = 'right';
    ctx.fillText(String(Math.ceil(buff.time)), x + 38, 68);
    ctx.textAlign = 'left';
  });

  ctx.restore();
}

function drawScorePopups(): void {
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '900 13px system-ui';
  for (const popup of scorePopups) {
    const screenY = popup.y - cameraY;
    if (screenY < -24 || screenY > HEIGHT + 24) continue;
    ctx.globalAlpha = Math.min(1, popup.life * 2);
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(35,48,61,0.85)'; ctx.fillStyle = popup.color;
    ctx.strokeText(popup.text, popup.x, screenY);
    ctx.fillText(popup.text, popup.x, screenY);
  }
  ctx.restore();
}

function render(now: number): void {
  drawBackground();
  platforms.forEach(drawPlatform);
  hazards.forEach(drawHazard);
  enemies.forEach(drawEnemy);
  pickups.forEach(drawPickup);
  drawParticles();
  drawPlayer(now);
  drawScorePopups();
  drawHud();
}

function loop(now: number): void {
  const active = started && !paused && !lost;
  const dt = active ? Math.min((now - (previous || now)) / 1000, 1 / 30) : 0;
  previous = now;
  if (active) update(dt);
  animationClock = now;
  render(animationClock);
  const idleDelay = document.hidden ? 250 : 1000 / 15;
  if (active) requestAnimationFrame(loop);
  else window.setTimeout(() => requestAnimationFrame(loop), idleDelay);
}

requestAnimationFrame(loop);


