const CONFIG = {
    laneWidth: 140, // Etwas breiter für bessere Sichtbarkeit
    baseSpeed: 10,
    maxSpeed: 30,
    acceleration: 0.0015,
    jumpForce: 16,
    gravity: 0.85,
    laneSwitchTime: 120, // Snappier
    spawnInterval: 1300, // Schnellerer Spawn
    // NEUE FARBPALETTE: Neon / Cyberpunk
    colors: {
        skyTop: '#000011',
        skyBottom: '#0a0a2a',
        ground: '#03030b',
        gridLines: '#00fff2', // Cyan grid
        gridLinesFar: '#ff00ff', // Magenta horizon
        
        // Spieler Skins (Neon Farben)
        playerSkins: [
            { main: '#00fff2', trail: '#007777' }, // Cyan
            { main: '#ff00ff', trail: '#770077' }, // Magenta
            { main: '#ffff00', trail: '#777700' }  // Yellow
        ],
        
        obstacle: '#ff3300', // Neon Red
        trainBody: '#1a1a2e',
        trainLights: '#00fff2',
        coin: '#ffd700', // Gold/Yellow Neon
        powerup: '#ffffff'
    }
};

const STATE = { MENU: 0, RUNNING: 1, PAUSED: 2, GAMEOVER: 3 };

// (AudioEngine bleibt gleich, gut genug für den Anfang)
class AudioEngine {
    constructor() {
        this.ctx = null; this.volume = 0.5;
    }
    init() { if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)(); }
    play(type) {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain); gain.connect(this.ctx.destination);
        const now = this.ctx.currentTime;
        gain.gain.setValueAtTime(this.volume, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
        if (type === 'jump') { osc.frequency.setValueAtTime(200, now); osc.frequency.linearRampToValueAtTime(600, now + 0.1); osc.type = 'sine'; } 
        else if (type === 'coin') { osc.frequency.setValueAtTime(1500, now); osc.frequency.exponentialRampToValueAtTime(2500, now + 0.05); gain.gain.setValueAtTime(this.volume*0.6, now); osc.type = 'sine'; } 
        else if (type === 'crash') { osc.frequency.setValueAtTime(150, now); osc.frequency.exponentialRampToValueAtTime(20, now + 0.4); osc.type = 'sawtooth'; } 
        else if (type === 'powerup') { osc.frequency.setValueAtTime(600, now); osc.frequency.linearRampToValueAtTime(1200, now + 0.3); osc.type = 'square'; }
        osc.start(); osc.stop(now + (type==='crash'?0.4:0.3));
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
        this.score = 0; this.coins = 0; this.distance = 0;
        this.speed = CONFIG.baseSpeed;
        
        this.lane = 1; this.targetLane = 1; this.laneX = 0;
        this.playerY = 0; this.playerZ = 0;
        this.isJumping = false; this.isSliding = false;
        this.slideTimer = 0; this.jumpV = 0;
        
        // Player trail für den Tron-Look
        this.playerTrail = [];
        
        this.powerups = { magnet: 0, shield: 0, multiplier: 0, boost: 0 };
        this.activeSkin = parseInt(localStorage.getItem('activeSkin')) || 0;
        this.highScore = parseInt(localStorage.getItem('highScore')) || 0;
        this.totalCoins = parseInt(localStorage.getItem('totalCoins')) || 0;

        this.debug = { godmode: false };
        this.spawnTimer = 0; this.shake = 0; this.frameCount = 0;

        this.init();
        this.resize();
        window.addEventListener('resize', () => this.resize());
        this.bindEvents();
        this.loop(0);
    }

    init() { this.updateUI(); this.renderSkins(); }
    resize() { this.canvas.width = window.innerWidth; this.canvas.height = window.innerHeight; }

    bindEvents() {
        // (Events bleiben weitgehend gleich, nur IDs angepasst)
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
        document.getElementById('reset-progress').onclick = () => { localStorage.clear(); location.reload(); };

        window.addEventListener('keydown', (e) => {
            if (this.state !== STATE.RUNNING) { if (e.key === 'Escape' && this.state === STATE.PAUSED) this.togglePause(); return; }
            if (e.key === 'a' || e.key === 'ArrowLeft') this.switchLane(-1);
            if (e.key === 'd' || e.key === 'ArrowRight') this.switchLane(1);
            if ((e.key === 'w' || e.key === 'ArrowUp' || e.key === ' ') && !this.isJumping) this.jump();
            if ((e.key === 's' || e.key === 'ArrowDown') && !this.isSliding) this.slide();
            if (e.key === 'Escape') this.togglePause();
            if (e.key === 'g') this.debug.godmode = !this.debug.godmode;
        });

        let touchStart = null;
        this.canvas.addEventListener('touchstart', (e) => touchStart = e.touches[0], {passive: true});
        this.canvas.addEventListener('touchend', (e) => {
            if (!touchStart || this.state !== STATE.RUNNING) return;
            const dx = e.changedTouches[0].clientX - touchStart.clientX;
            const dy = e.changedTouches[0].clientY - touchStart.clientY;
            if (Math.abs(dx) > Math.abs(dy)) { if (Math.abs(dx) > 30) this.switchLane(dx > 0 ? 1 : -1); } 
            else { if (dy < -30) this.jump(); else if (dy > 30) this.slide(); }
        }, {passive: true});
    }

    start() {
        this.audio.init();
        this.state = STATE.RUNNING;
        this.entities = [];
        this.playerTrail = [];
        this.score = 0; this.coins = 0; this.distance = 0;
        this.speed = CONFIG.baseSpeed;
        this.lane = 1; this.targetLane = 1; this.laneX = 0;
        this.powerups = { magnet: 0, shield: 0, multiplier: 0, boost: 0 };
        this.showOverlay('hud');
        if (document.getElementById('tutorial-toggle').checked) this.showTutorial();
    }

    showTutorial() {
        const tut = document.getElementById('tutorial-overlay');
        tut.classList.add('active'); setTimeout(() => tut.classList.remove('active'), 2500);
    }

    togglePause() {
        this.state = this.state === STATE.RUNNING ? STATE.PAUSED : STATE.RUNNING;
        this.showOverlay(this.state === STATE.PAUSED ? 'pause-screen' : 'hud');
    }

    exitToMenu() {
        this.state = STATE.MENU;
        this.updateUI();
        this.showOverlay('menu-screen');
    }

    gameOver() {
        this.state = STATE.GAMEOVER;
        this.audio.play('crash');
        this.highScore = Math.max(this.score, this.highScore);
        localStorage.setItem('highScore', this.highScore);
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
        document.getElementById('high-score-val').innerText = Math.floor(this.highScore);
        document.getElementById('score-val').innerText = Math.floor(this.score);
        document.getElementById('coins-val').innerText = this.coins;
        document.getElementById('speed-val').innerText = Math.floor((this.speed / CONFIG.baseSpeed) * 100);
    }

    renderSkins() {
        const list = document.getElementById('skin-list'); list.innerHTML = '';
        CONFIG.colors.playerSkins.forEach((skin, i) => {
            const card = document.createElement('div');
            card.className = `skin-card ${this.activeSkin === i ? 'selected' : ''}`;
            card.innerHTML = `<div class="skin-preview" style="background:linear-gradient(45deg, ${skin.main}, ${skin.trail})"></div>`;
            card.onclick = () => { this.activeSkin = i; localStorage.setItem('activeSkin', i); this.renderSkins(); };
            list.appendChild(card);
        });
    }

    switchLane(dir) { this.targetLane = Math.max(0, Math.min(2, this.targetLane + dir)); }
    jump() { if (this.isJumping) return; this.isJumping = true; this.jumpV = CONFIG.jumpForce; this.isSliding = false; this.audio.play('jump'); }
    slide() { this.isSliding = true; this.slideTimer = 35; this.isJumping = false; this.jumpV = -10; }

    spawn() {
        const lane = Math.floor(Math.random() * 3);
        const typeRoll = Math.random();
        // Start-Z weiter hinten (1500) für sanfteres Einblenden
        const startZ = 1500;

        if (typeRoll < 0.55) { // 55% Chance für Hindernis/Zug
            const isTrain = Math.random() > 0.5; // 50/50 Zug oder Barriere
            // Züge sind viel länger (depth) und höher
            const depth = isTrain ? 400 : 20; 
            const height = isTrain ? 160 : (Math.random() > 0.5 ? 50 : 110);
            
            this.entities.push({
                type: isTrain ? 'train' : 'barrier',
                lane, z: startZ, h: height, depth: depth,
                moving: isTrain && Math.random() > 0.7, // Manchmal entgegenkommend
                rot: 0 // Für Münz-Rotation
            });
        } else if (typeRoll < 0.85) { // 30% Chance für Münzen
            const pattern = Math.random();
            for(let i=0; i<5; i++) {
                // Münzen in Bogen oder Linie
                let laneOffset = 0;
                if (pattern > 0.6) laneOffset = Math.sin(i) * 0.5;
                
                this.entities.push({ 
                    type: 'coin', lane: lane + laneOffset, 
                    z: startZ + (i * 50), rot: Math.random() * Math.PI 
                });
            }
        } else { // 15% Powerup
            const pTypes = ['magnet', 'shield', 'multiplier', 'boost'];
            this.entities.push({ 
                type: 'powerup', 
                pType: pTypes[Math.floor(Math.random() * pTypes.length)],
                lane, z: startZ, rot: 0
            });
        }
    }

    update(dt) {
        if (this.state !== STATE.RUNNING) return;
        this.frameCount++;

        this.speed = Math.min(CONFIG.maxSpeed, this.speed + CONFIG.acceleration * dt);
        const effectiveSpeed = this.powerups.boost > 0 ? this.speed * 1.5 : this.speed;
        this.distance += effectiveSpeed * (dt / 16);
        this.score += (effectiveSpeed / 10) * (this.powerups.multiplier > 0 ? 2 : 1);

        // Snappy lane switching mit lerp
        this.laneX += (this.targetLane - this.lane) * (dt / CONFIG.laneSwitchTime);
        if (Math.abs(this.targetLane - this.laneX) < 0.01) this.lane = this.targetLane;

        if (this.isJumping) {
            this.playerZ += this.jumpV; this.jumpV -= CONFIG.gravity;
            if (this.playerZ <= 0) { this.playerZ = 0; this.isJumping = false; }
        }
        if (this.isSliding) {
            this.slideTimer -= dt / 16;
            if (this.slideTimer <= 0) this.isSliding = false;
        }

        // Player Trail speichern
        if (this.frameCount % 2 === 0) {
             this.playerTrail.unshift({ x: this.laneX, z: this.playerZ, slide: this.isSliding });
             if (this.playerTrail.length > 10) this.playerTrail.pop();
        }

        this.spawnTimer += dt;
        // Spawnrate abhängig von Speed
        if (this.spawnTimer > CONFIG.spawnInterval - (this.speed * 15)) {
            this.spawn();
            this.spawnTimer = 0;
        }

        for (let i = this.entities.length - 1; i >= 0; i--) {
            const e = this.entities[i];
            let zMove = effectiveSpeed;
            if (e.moving) zMove += 8; // Entgegenkommende Züge sind schneller
            e.z -= zMove * (dt / 16);
            
            // Münzen und Powerups rotieren
            if (e.type === 'coin' || e.type === 'powerup') e.rot += dt * 0.005;

            if (this.powerups.magnet > 0 && e.type === 'coin' && e.z < 500 && e.z > -50) {
                e.lane += (this.laneX - e.lane) * 0.15; // Stärkerer Magnet
                e.z -= effectiveSpeed * 0.5; // Kommen auf den Spieler zu
            }

            if (e.z < -200) { this.entities.splice(i, 1); continue; }

            // Kollisionsabfrage (etwas vergrößert für Züge)
            if (e.z < 100 && e.z > 0 && !this.debug.godmode) {
                const laneDist = Math.abs(e.lane - this.laneX);
                // Züge sind breiter, daher größere Toleranz
                const collisionThreshold = e.type === 'train' ? 0.6 : 0.4;
                
                if (laneDist < collisionThreshold) {
                    this.checkCollision(e);
                }
            }
        }

        Object.keys(this.powerups).forEach(k => { if (this.powerups[k] > 0) this.powerups[k] -= dt; });
        if (this.shake > 0) this.shake -= 0.1;
        this.updateUI(); this.updatePowerupUI();
    }

    checkCollision(e) {
        if (e.type === 'coin') {
            this.coins++; this.entities.splice(this.entities.indexOf(e), 1);
            this.audio.play('coin'); return;
        }
        if (e.type === 'powerup') {
            this.powerups[e.pType] = 8000; this.entities.splice(this.entities.indexOf(e), 1);
            this.audio.play('powerup'); return;
        }
        if (this.powerups.boost > 0) return;

        let hit = false;
        if (e.type === 'barrier') {
            if (e.h > 60 && !this.isSliding) hit = true;
            if (e.h <= 60 && !this.isJumping) hit = true;
        } else if (e.type === 'train') {
            // Züge trifft man fast immer, wenn man nicht die Spur wechselt
            if (this.playerZ < 150) hit = true; 
        }

        if (hit) {
            if (this.powerups.shield > 0) {
                this.powerups.shield = 0;
                this.entities.splice(this.entities.indexOf(e), 1);
                this.shake = 10;
                this.audio.play('crash');
            } else {
                this.gameOver();
            }
        }
    }

    updatePowerupUI() {
        const container = document.getElementById('powerup-timers'); container.innerHTML = '';
        Object.entries(this.powerups).forEach(([k, v]) => {
            if (v > 0) {
                const el = document.createElement('div'); el.className = 'p-timer';
                el.innerText = `${k}: ${(v/1000).toFixed(1)}s`; container.appendChild(el);
            }
        });
    }

    // ==========================================
    // NEUES RENDERING SYSTEM (FUTURISTIC LOOK)
    // ==========================================
    draw() {
        const { ctx, canvas } = this;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (this.shake > 0) {
            const s = this.shake;
            ctx.translate((Math.random()-0.5)*s, (Math.random()-0.5)*s);
        }

        const horizon = canvas.height * 0.4;
        const centerX = canvas.width / 2;
        
        // 1. Himmel & Boden (Gradienten)
        const skyGrad = ctx.createLinearGradient(0, 0, 0, horizon);
        skyGrad.addColorStop(0, CONFIG.colors.skyTop);
        skyGrad.addColorStop(1, CONFIG.colors.skyBottom);
        ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, canvas.width, horizon);

        ctx.fillStyle = CONFIG.colors.ground; 
        ctx.fillRect(0, horizon, canvas.width, canvas.height-horizon);

        // 2. Horizont-Glow
        ctx.shadowBlur = 20; ctx.shadowColor = CONFIG.colors.gridLinesFar;
        ctx.strokeStyle = CONFIG.colors.gridLinesFar; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, horizon); ctx.lineTo(canvas.width, horizon); ctx.stroke();
        ctx.shadowBlur = 0;

        // Helper für 3D Projektion
        const project = (lane, z) => {
            // Distanz-Skalierung: Dinge werden kleiner, je weiter weg
            const scale = 1 / (z / 600 + 1); 
            const x = centerX + (lane - 1) * CONFIG.laneWidth * scale * 1.5; // 1.5x Multiplier für breitere Spuren
            const y = horizon + (canvas.height - horizon) * scale;
            return { x, y, scale };
        };

        // 3. Grid-Linien (Spuren)
        ctx.shadowBlur = 10; ctx.shadowColor = CONFIG.colors.gridLines;
        ctx.strokeStyle = CONFIG.colors.gridLines; ctx.lineWidth = 2;
        for (let i = 0; i <= 3; i++) {
            const p1 = project(i - 0.5, 0);
            const p2 = project(i - 0.5, 2000);
            ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
        }
        ctx.shadowBlur = 0;


        // 4. Entitäten zeichnen (von hinten nach vorne sortiert)
        this.entities.sort((a, b) => b.z - a.z).forEach(e => {
            // Rendere Objekte auch, wenn sie leicht hinter der Kamera sind, für flüssigen Abgang
            if (e.z < -300 || e.z > 1800) return;

            const pos = project(e.lane, e.z);
            const scale = pos.scale;
            const w = CONFIG.laneWidth * scale * 0.8;
            
            // Grundlegender Glow für alle Objekte
            ctx.shadowBlur = 15 * scale;

            if (e.type === 'coin' || e.type === 'powerup') {
                // Rotiere Coins/Powerups
                const size = 30 * scale;
                ctx.shadowColor = e.type==='coin' ? CONFIG.colors.coin : CONFIG.colors.powerup;
                ctx.fillStyle = ctx.shadowColor;
                
                ctx.save();
                ctx.translate(pos.x, pos.y - size);
                ctx.rotate(e.rot);
                // Zeichne Diamant-Form
                ctx.beginPath(); 
                ctx.moveTo(0, -size); ctx.lineTo(size, 0); 
                ctx.lineTo(0, size); ctx.lineTo(-size, 0); 
                ctx.closePath(); ctx.fill();
                ctx.restore();

            } else if (e.type === 'train') {
                // Züge sind lang! Wir brauchen den vorderen und hinteren Punkt.
                const frontPos = pos;
                // Das Heck des Zuges ist weiter hinten im Z-Raum
                const backPos = project(e.lane, e.z + e.depth); 

                const h = e.h * scale;
                const backH = e.h * backPos.scale;
                const backW = CONFIG.laneWidth * backPos.scale * 0.8;

                // Zug Körper (Dunkelblau mit Glow)
                ctx.shadowColor = CONFIG.colors.trainLights;
                ctx.fillStyle = CONFIG.colors.trainBody;

                ctx.beginPath();
                // Front Face
                ctx.moveTo(frontPos.x - w/2, frontPos.y);
                ctx.lineTo(frontPos.x + w/2, frontPos.y);
                ctx.lineTo(frontPos.x + w/2, frontPos.y - h);
                ctx.lineTo(frontPos.x - w/2, frontPos.y - h);
                // Verbindung zum Heck (Dach & Seite)
                ctx.lineTo(backPos.x - backW/2, backPos.y - backH);
                ctx.lineTo(backPos.x + backW/2, backPos.y - backH);
                ctx.lineTo(frontPos.x + w/2, frontPos.y - h);
                ctx.fill();

                // Zug Lichter vorne
                ctx.fillStyle = CONFIG.colors.trainLights;
                ctx.fillRect(frontPos.x - w*0.4, frontPos.y - h*0.8, w*0.2, h*0.2);
                ctx.fillRect(frontPos.x + w*0.2, frontPos.y - h*0.8, w*0.2, h*0.2);

            } else if (e.type === 'barrier') {
                // Hindernis (Neon Rechtecke)
                const h = e.h * scale;
                ctx.shadowColor = CONFIG.colors.obstacle;
                ctx.fillStyle = CONFIG.colors.obstacle;
                ctx.beginPath();
                ctx.moveTo(pos.x - w/2, pos.y);
                ctx.lineTo(pos.x + w/2, pos.y);
                ctx.lineTo(pos.x + w/2, pos.y - h);
                ctx.lineTo(pos.x - w/2, pos.y - h);
                ctx.closePath();
                ctx.fill();
            }
        });
        ctx.shadowBlur = 0;

        // 5. Spieler Rendern (Tron-Style)
        const skin = CONFIG.colors.playerSkins[this.activeSkin];
        
        // Player Position im Z-Raum für Sprünge
        const playerZ = this.playerZ; 
        // Player Scale ist immer 1, da er am nächsten ist
        const pScale = 1; 
        
        const pW = 40 * pScale;
        const pH = 50 * pScale;
        const pX = centerX + (this.laneX - 1) * CONFIG.laneWidth * pScale * 1.5;
        const pY = horizon + (canvas.height - horizon) * pScale - playerZ;

        // Player Trail
        ctx.shadowBlur = 10; ctx.shadowColor = skin.trail; ctx.lineWidth = 5 * pScale;
        ctx.strokeStyle = skin.trail;
        ctx.beginPath();
        ctx.moveTo(pX, pY + pH);
        this.playerTrail.forEach(t => {
             // Trail wird kleiner nach hinten
             const s = 1 / (t.z / 600 + 1);
             const x = centerX + (t.x - 1) * CONFIG.laneWidth * s * 1.5;
             const y = horizon + (canvas.height - horizon) * s - t.z;
             ctx.lineTo(x, y + pH);
        });
        ctx.stroke();

        // Spieler (Neon Hovercraft)
        ctx.shadowBlur = 25; ctx.shadowColor = skin.main;
        ctx.fillStyle = skin.main;
        ctx.beginPath();
        if (this.isSliding) {
            // Flache Kapsel für Slide
            const h = pH * 0.4;
            ctx.moveTo(pX - pW/2, pY + pH);
            ctx.lineTo(pX + pW/2, pY + pH);
            ctx.lineTo(pX + pW/3, pY + pH - h);
            ctx.lineTo(pX - pW/3, pY + pH - h);
            ctx.closePath();
            ctx.fill();
        } else {
            // Hovercraft für Run/Jump
            ctx.moveTo(pX - pW/2, pY + pH);
            ctx.lineTo(pX + pW/2, pY + pH);
            ctx.lineTo(pX + pW/3, pY + pH - pH*0.8);
            ctx.lineTo(pX - pW/3, pY + pH - pH*0.8);
            ctx.closePath();
            ctx.fill();
            // Oberteil (Licht)
            ctx.shadowBlur = 10;
            ctx.fillStyle = skin.trail;
            ctx.fillRect(pX - pW/4, pY + pH*0.2, pW/2, pH*0.2);
        }
        ctx.shadowBlur = 0;

        if (this.shake > 0) ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    loop(time) {
        const dt = time - this.lastTime; this.lastTime = time;
        this.update(dt); this.draw();
        requestAnimationFrame((t) => this.loop(t));
    }
}

const game = new Game();
