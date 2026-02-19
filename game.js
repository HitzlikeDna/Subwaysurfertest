
const CONFIG = {
    laneWidth: 120,
    baseSpeed: 8,
    maxSpeed: 25,
    acceleration: 0.001,
    jumpForce: 15,
    gravity: 0.8,
    laneSwitchTime: 140,
    spawnInterval: 1500,
    colors: {
        lanes: ['#333', '#444', '#333'],
        player: ['#ff0000', '#00ff00', '#0000ff'],
        obstacle: '#555',
        train: '#222',
        coin: '#ffd700',
        powerup: '#00ffff'
    }
};

const STATE = { MENU: 0, RUNNING: 1, PAUSED: 2, GAMEOVER: 3 };

class AudioEngine {
    constructor() {
        this.ctx = null;
        this.volume = 0.5;
    }

    init() {
        if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }

    play(type) {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        
        const now = this.ctx.currentTime;
        gain.gain.setValueAtTime(this.volume, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);

        if (type === 'jump') {
            osc.frequency.setValueAtTime(150, now);
            osc.frequency.exponentialRampToValueAtTime(400, now + 0.1);
            osc.type = 'triangle';
        } else if (type === 'coin') {
            osc.frequency.setValueAtTime(800, now);
            osc.frequency.exponentialRampToValueAtTime(1200, now + 0.1);
            osc.type = 'sine';
        } else if (type === 'crash') {
            osc.frequency.setValueAtTime(100, now);
            osc.frequency.exponentialRampToValueAtTime(20, now + 0.3);
            osc.type = 'sawtooth';
        } else if (type === 'powerup') {
            osc.frequency.setValueAtTime(400, now);
            osc.frequency.linearRampToValueAtTime(800, now + 0.2);
            osc.type = 'square';
        }

        osc.start();
        osc.stop(now + 0.3);
    }
}

class Particle {
    constructor(x, y, color) {
        this.x = x;
        this.y = y;
        this.color = color;
        this.vx = (Math.random() - 0.5) * 10;
        this.vy = (Math.random() - 0.5) * 10;
        this.life = 1.0;
    }
    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.life -= 0.02;
    }
}

class Game {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.audio = new AudioEngine();
        
        this.state = STATE.MENU;
        this.lastTime = 0;
        this.entities = [];
        this.particles = [];
        this.score = 0;
        this.coins = 0;
        this.distance = 0;
        this.speed = CONFIG.baseSpeed;
        
        this.lane = 1;
        this.targetLane = 1;
        this.laneX = 0;
        this.playerY = 0;
        this.playerZ = 0;
        this.isJumping = false;
        this.isSliding = false;
        this.slideTimer = 0;
        this.jumpV = 0;
        
        this.powerups = { magnet: 0, shield: 0, multiplier: 0, boost: 0 };
        this.skins = ['#ffcc00', '#00ffcc', '#ff00ff'];
        this.activeSkin = parseInt(localStorage.getItem('activeSkin')) || 0;
        this.highScore = parseInt(localStorage.getItem('highScore')) || 0;
        this.totalCoins = parseInt(localStorage.getItem('totalCoins')) || 0;

        this.debug = { hitboxes: false, fps: false, godmode: false };
        this.fps = 0;
        this.spawnTimer = 0;
        this.shake = 0;

        this.init();
        this.resize();
        window.addEventListener('resize', () => this.resize());
        this.bindEvents();
        this.loop(0);
    }

    init() {
        this.updateUI();
        this.renderSkins();
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    bindEvents() {
        document.getElementById('start-btn').onclick = () => this.start();
        document.getElementById('resume-btn').onclick = () => this.togglePause();
        document.getElementById('restart-btn-p').onclick = () => this.start();
        document.getElementById('retry-btn').onclick = () => this.start();
        document.getElementById('menu-btn-p').onclick = () => this.exitToMenu();
        document.getElementById('menu-btn-g').onclick = () => this.exitToMenu();
        document.getElementById('skins-btn').onclick = () => this.showOverlay('skin-screen');
        document.getElementById('settings-btn').onclick = () => this.showOverlay('settings-screen');
        document.querySelectorAll('[id^="back-"]').forEach(btn => btn.onclick = () => this.showOverlay('menu-screen'));
        
        document.getElementById('volume-sfx').oninput = (e) => this.audio.volume = e.target.value;
        document.getElementById('reset-progress').onclick = () => {
            localStorage.clear();
            location.reload();
        };

        window.addEventListener('keydown', (e) => {
            if (this.state !== STATE.RUNNING) {
                if (e.key === 'Escape' && this.state === STATE.PAUSED) this.togglePause();
                return;
            }
            if (e.key === 'a' || e.key === 'ArrowLeft') this.switchLane(-1);
            if (e.key === 'd' || e.key === 'ArrowRight') this.switchLane(1);
            if ((e.key === 'w' || e.key === 'ArrowUp' || e.key === ' ') && !this.isJumping) this.jump();
            if ((e.key === 's' || e.key === 'ArrowDown') && !this.isSliding) this.slide();
            if (e.key === 'Escape') this.togglePause();
            if (e.key === 'h') this.debug.hitboxes = !this.debug.hitboxes;
            if (e.key === 'g') this.debug.godmode = !this.debug.godmode;
            if (e.key === '`') this.debug.fps = !this.debug.fps;
        });

        let touchStart = null;
        this.canvas.addEventListener('touchstart', (e) => touchStart = e.touches[0]);
        this.canvas.addEventListener('touchend', (e) => {
            if (!touchStart || this.state !== STATE.RUNNING) return;
            const dx = e.changedTouches[0].clientX - touchStart.clientX;
            const dy = e.changedTouches[0].clientY - touchStart.clientY;
            if (Math.abs(dx) > Math.abs(dy)) {
                if (Math.abs(dx) > 30) this.switchLane(dx > 0 ? 1 : -1);
            } else {
                if (dy < -30) this.jump();
                else if (dy > 30) this.slide();
            }
        });
    }

    start() {
        this.audio.init();
        this.state = STATE.RUNNING;
        this.entities = [];
        this.particles = [];
        this.score = 0;
        this.coins = 0;
        this.distance = 0;
        this.speed = CONFIG.baseSpeed;
        this.lane = 1;
        this.targetLane = 1;
        this.laneX = 0;
        this.powerups = { magnet: 0, shield: 0, multiplier: 0, boost: 0 };
        this.showOverlay('hud');
        if (document.getElementById('tutorial-toggle').checked) {
            this.showTutorial();
        }
    }

    showTutorial() {
        const tut = document.getElementById('tutorial-overlay');
        tut.classList.add('active');
        setTimeout(() => tut.classList.remove('active'), 3000);
    }

    togglePause() {
        if (this.state === STATE.RUNNING) {
            this.state = STATE.PAUSED;
            this.showOverlay('pause-screen');
        } else if (this.state === STATE.PAUSED) {
            this.state = STATE.RUNNING;
            this.showOverlay('hud');
        }
    }

    exitToMenu() {
        this.state = STATE.MENU;
        this.updateUI();
        this.showOverlay('menu-screen');
    }

    gameOver() {
        this.state = STATE.GAMEOVER;
        this.audio.play('crash');
        if (this.score > this.highScore) {
            this.highScore = this.score;
            localStorage.setItem('highScore', this.highScore);
        }
        this.totalCoins += this.coins;
        localStorage.setItem('totalCoins', this.totalCoins);
        
        document.getElementById('final-score').innerText = Math.floor(this.score);
        document.getElementById('final-coins').innerText = this.coins;
        this.showOverlay('gameover-screen');
    }

    showOverlay(id) {
        document.querySelectorAll('.overlay').forEach(el => el.classList.remove('active'));
        document.getElementById(id).classList.add('active');
    }

    updateUI() {
        document.getElementById('high-score-val').innerText = this.highScore;
        document.getElementById('score-val').innerText = Math.floor(this.score);
        document.getElementById('coins-val').innerText = this.coins;
    }

    renderSkins() {
        const list = document.getElementById('skin-list');
        list.innerHTML = '';
        this.skins.forEach((color, i) => {
            const card = document.createElement('div');
            card.className = `skin-card ${this.activeSkin === i ? 'selected' : ''}`;
            card.innerHTML = `<div class="skin-preview" style="background:${color}"></div>`;
            card.onclick = () => {
                this.activeSkin = i;
                localStorage.setItem('activeSkin', i);
                this.renderSkins();
            };
            list.appendChild(card);
        });
    }

    switchLane(dir) {
        this.targetLane = Math.max(0, Math.min(2, this.targetLane + dir));
    }

    jump() {
        if (this.isJumping) return;
        this.isJumping = true;
        this.jumpV = CONFIG.jumpForce;
        this.isSliding = false;
        this.audio.play('jump');
    }

    slide() {
        this.isSliding = true;
        this.slideTimer = 40;
        this.isJumping = false;
        this.jumpV = -10;
    }

    spawn() {
        const typeRoll = Math.random();
        const lane = Math.floor(Math.random() * 3);
        
        if (typeRoll < 0.7) {
            const isTrain = Math.random() > 0.6;
            const moving = isTrain && this.distance > 500 && Math.random() > 0.7;
            this.entities.push({
                type: isTrain ? 'train' : 'barrier',
                lane,
                z: 1000,
                h: isTrain ? 150 : (Math.random() > 0.5 ? 40 : 100),
                moving: moving,
                warning: moving ? 60 : 0
            });
        } else if (typeRoll < 0.9) {
            for(let i=0; i<5; i++) {
                this.entities.push({ type: 'coin', lane, z: 1000 + (i * 40) });
            }
        } else {
            const pTypes = ['magnet', 'shield', 'multiplier', 'boost'];
            this.entities.push({ 
                type: 'powerup', 
                pType: pTypes[Math.floor(Math.random() * pTypes.length)],
                lane, 
                z: 1000 
            });
        }
    }

    update(dt) {
        if (this.state !== STATE.RUNNING) return;

        this.speed = Math.min(CONFIG.maxSpeed, this.speed + CONFIG.acceleration * dt);
        const effectiveSpeed = this.powerups.boost > 0 ? this.speed * 2 : this.speed;
        this.distance += effectiveSpeed * (dt / 16);
        this.score += (effectiveSpeed / 10) * (this.powerups.multiplier > 0 ? 2 : 1);

        this.laneX += (this.targetLane - this.lane) * (dt / CONFIG.laneSwitchTime);
        if (Math.abs(this.targetLane - this.laneX) < 0.05) this.lane = this.targetLane;

        if (this.isJumping) {
            this.playerZ += this.jumpV;
            this.jumpV -= CONFIG.gravity;
            if (this.playerZ <= 0) {
                this.playerZ = 0;
                this.isJumping = false;
            }
        }

        if (this.isSliding) {
            this.slideTimer -= dt / 16;
            if (this.slideTimer <= 0) this.isSliding = false;
        }

        this.spawnTimer += dt;
        if (this.spawnTimer > CONFIG.spawnInterval - (this.speed * 20)) {
            this.spawn();
            this.spawnTimer = 0;
        }

        for (let i = this.entities.length - 1; i >= 0; i--) {
            const e = this.entities[i];
            let zMove = effectiveSpeed;
            if (e.moving) zMove += 10;
            e.z -= zMove * (dt / 16);

            if (this.powerups.magnet > 0 && e.type === 'coin' && e.z < 400) {
                e.lane += (this.laneX - e.lane) * 0.1;
            }

            if (e.z < -100) {
                this.entities.splice(i, 1);
                continue;
            }

            if (e.z < 100 && e.z > 0 && !this.debug.godmode) {
                const laneDist = Math.abs(e.lane - this.laneX);
                if (laneDist < 0.4) {
                    this.checkCollision(e);
                }
            }
        }

        Object.keys(this.powerups).forEach(k => {
            if (this.powerups[k] > 0) this.powerups[k] -= dt;
        });

        this.particles.forEach((p, i) => {
            p.update();
            if (p.life <= 0) this.particles.splice(i, 1);
        });

        if (this.shake > 0) this.shake -= 0.1;
        
        this.updateUI();
        this.updatePowerupUI();
    }

    checkCollision(e) {
        if (e.type === 'coin') {
            this.coins++;
            this.entities.splice(this.entities.indexOf(e), 1);
            this.audio.play('coin');
            this.burst(this.canvas.width / 2 + (this.laneX - 1) * CONFIG.laneWidth, this.canvas.height - 100, CONFIG.colors.coin);
            return;
        }
        if (e.type === 'powerup') {
            this.powerups[e.pType] = 10000;
            this.entities.splice(this.entities.indexOf(e), 1);
            this.audio.play('powerup');
            return;
        }
        
        if (this.powerups.boost > 0) return;

        let hit = false;
        if (e.type === 'barrier') {
            if (e.h > 60 && !this.isSliding) hit = true;
            if (e.h <= 60 && !this.isJumping) hit = true;
        } else if (e.type === 'train') {
            if (this.playerZ < 80) hit = true;
        }

        if (hit) {
            if (this.powerups.shield > 0) {
                this.powerups.shield = 0;
                this.entities.splice(this.entities.indexOf(e), 1);
                this.shake = 5;
            } else {
                this.gameOver();
            }
        }
    }

    updatePowerupUI() {
        const container = document.getElementById('powerup-timers');
        container.innerHTML = '';
        Object.entries(this.powerups).forEach(([k, v]) => {
            if (v > 0) {
                const el = document.createElement('div');
                el.className = 'p-timer';
                el.innerText = `${k.toUpperCase()}: ${(v/1000).toFixed(1)}s`;
                container.appendChild(el);
            }
        });
    }

    burst(x, y, color) {
        for(let i=0; i<8; i++) this.particles.push(new Particle(x, y, color));
    }

    draw() {
        const { ctx, canvas } = this;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (this.shake > 0) {
            ctx.translate(Math.random() * this.shake, Math.random() * this.shake);
        }

        const horizon = canvas.height * 0.4;
        const centerX = canvas.width / 2;

        for (let i = 0; i < 3; i++) {
            ctx.fillStyle = CONFIG.colors.lanes[i];
            const x1 = centerX + (i - 1.5) * CONFIG.laneWidth * 0.2;
            const x2 = centerX + (i - 0.5) * CONFIG.laneWidth * 0.2;
            const x3 = centerX + (i - 0.5) * CONFIG.laneWidth * 4;
            const x4 = centerX + (i - 1.5) * CONFIG.laneWidth * 4;
            
            ctx.beginPath();
            ctx.moveTo(x1, horizon);
            ctx.lineTo(x2, horizon);
            ctx.lineTo(x3, canvas.height);
            ctx.lineTo(x4, canvas.height);
            ctx.fill();
        }

        const getProjectedPos = (lane, z) => {
            const scale = 1 / (z / 500 + 1);
            const x = centerX + (lane - 1) * CONFIG.laneWidth * scale;
            const y = horizon + (canvas.height - horizon) * scale;
            return { x, y, scale };
        };

        this.entities.sort((a, b) => b.z - a.z).forEach(e => {
            const pos = getProjectedPos(e.lane, e.z);
            if (pos.y < horizon) return;

            const w = CONFIG.laneWidth * pos.scale;
            const h = e.h ? e.h * pos.scale : 40 * pos.scale;

            if (e.type === 'train' && e.warning > 0) {
                ctx.fillStyle = 'rgba(255, 0, 0, ' + (Math.sin(Date.now() / 100) * 0.5 + 0.5) + ')';
                ctx.fillRect(pos.x - w/2, horizon, w, 10);
            }

            ctx.fillStyle = e.type === 'coin' ? CONFIG.colors.coin : 
                           e.type === 'powerup' ? CONFIG.colors.powerup : 
                           e.type === 'train' ? CONFIG.colors.train : CONFIG.colors.obstacle;
            
            ctx.fillRect(pos.x - w/2, pos.y - h, w, h);
            
            if (this.debug.hitboxes) {
                ctx.strokeStyle = '#0f0';
                ctx.strokeRect(pos.x - w/2, pos.y - h, w, h);
            }
        });

        const pPos = { x: centerX + (this.laneX - 1) * CONFIG.laneWidth, y: canvas.height - 80 };
        const pSize = 50;
        const jumpOffset = this.playerZ;
        const pDrawH = this.isSliding ? pSize / 2 : pSize;

        if (this.powerups.boost > 0) {
            ctx.fillStyle = 'rgba(0, 255, 255, 0.3)';
            ctx.fillRect(pPos.x - pSize, 0, pSize * 2, canvas.height);
        }

        ctx.fillStyle = this.skins[this.activeSkin];
        if (this.powerups.shield > 0) {
            ctx.strokeStyle = '#00ffff';
            ctx.lineWidth = 5;
            ctx.strokeRect(pPos.x - pSize / 2 - 5, pPos.y - pDrawH - jumpOffset - 5, pSize + 10, pDrawH + 10);
        }
        ctx.fillRect(pPos.x - pSize / 2, pPos.y - pDrawH - jumpOffset, pSize, pDrawH);

        this.particles.forEach(p => {
            ctx.globalAlpha = p.life;
            ctx.fillStyle = p.color;
            ctx.fillRect(p.x, p.y, 4, 4);
        });
        ctx.globalAlpha = 1.0;

        if (this.shake > 0) ctx.setTransform(1, 0, 0, 1, 0, 0);

        if (this.debug.fps) {
            document.getElementById('debug-info').innerText = `FPS: ${this.fps} | SPEED: ${this.speed.toFixed(1)} | GOD: ${this.debug.godmode}`;
        } else {
            document.getElementById('debug-info').innerText = '';
        }
    }

    loop(time) {
        const dt = time - this.lastTime;
        this.lastTime = time;
        this.fps = Math.round(1000 / dt);

        this.update(dt);
        this.draw();
        requestAnimationFrame((t) => this.loop(t));
    }
}

const game = new Game();
