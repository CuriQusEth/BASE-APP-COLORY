import { ChangeDetectionStrategy, Component, signal, WritableSignal, effect, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';

type GameState = 'loading' | 'start' | 'showing' | 'playing' | 'gameover';
type Difficulty = 'easy' | 'medium' | 'hard';
type GameMode = 'classic' | 'zen';

// --- Daily Task Types ---
interface GameStats {
  score: number;
  consecutiveLevels: number;
}

interface TaskDefinition {
  id: string;
  description: (target: number) => string;
  target: () => number;
  progressTracker: (stats: GameStats) => number;
}

interface DailyTask {
  id: string;
  description: string;
  target: number;
  progress: number;
  completed: boolean;
}

// --- Farcaster MiniApp Types ---
interface FarcasterUser {
  fid: number;
  username: string;
  displayName: string;
  pfpUrl: string;
}


@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule],
})
export class AppComponent implements OnInit {
  GRID_SIZE = 9;

  // Game State Signals
  gameState: WritableSignal<GameState> = signal('loading');
  sequence = signal<number[]>([]);
  playerSequence = signal<number[]>([]);
  level = signal(0);
  score = signal(0);
  highScore = signal(0);
  activeTile = signal<number | null>(null);
  isShaking = signal(false);

  // Settings Signals
  gameMode = signal<GameMode>('classic');
  difficulty = signal<Difficulty>('medium');
  selectedPaletteIndex = signal<number>(0);
  isMuted = signal<boolean>(false);
  bestZenSequence = signal(0);
  
  // Daily Task Signals
  dailyTask = signal<DailyTask | null>(null);
  consecutiveLevels = signal(0);
  taskJustCompleted = signal(false);

  // Farcaster User
  farcasterUser = signal<FarcasterUser | null>(null);
  
  private audioContext: AudioContext | null = null;
  
  readonly difficultySettings = {
    easy: { sequenceDelay: 700, flashDuration: 500 },
    medium: { sequenceDelay: 500, flashDuration: 350 },
    hard: { sequenceDelay: 300, flashDuration: 200 },
  };

  readonly palettes = [
    { name: 'Iznik Turquoise', colors: ['bg-cyan-500', 'bg-sky-600', 'bg-teal-400', 'bg-slate-100', 'bg-red-500', 'bg-blue-800', 'bg-cyan-300', 'bg-sky-400', 'bg-teal-600'] },
    { name: 'Cappadocia Sunrise', colors: ['bg-orange-400', 'bg-rose-300', 'bg-amber-200', 'bg-stone-400', 'bg-red-400', 'bg-yellow-500', 'bg-orange-300', 'bg-rose-400', 'bg-amber-400'] },
    { name: 'Ottoman Jewels', colors: ['bg-emerald-600', 'bg-red-700', 'bg-blue-700', 'bg-amber-400', 'bg-purple-700', 'bg-green-500', 'bg-rose-600', 'bg-indigo-600', 'bg-yellow-600'] },
    { name: 'Aegean Breeze', colors: ['bg-sky-500', 'bg-blue-400', 'bg-indigo-300', 'bg-slate-100', 'bg-cyan-200', 'bg-blue-700', 'bg-sky-300', 'bg-blue-500', 'bg-indigo-500'] },
    { name: 'Grand Bazaar', colors: ['bg-yellow-600', 'bg-red-600', 'bg-orange-700', 'bg-amber-800', 'bg-lime-600', 'bg-yellow-700', 'bg-red-800', 'bg-orange-500', 'bg-amber-500'] }
  ];

  private readonly taskDefinitions: TaskDefinition[] = [
    {
      id: 'score_single_game',
      description: target => `Score ${target} points in a single game`,
      target: () => (5 + Math.floor(Math.random() * 6)) * 100, // 500 to 1000
      progressTracker: stats => stats.score
    },
    {
      id: 'consecutive_levels',
      description: target => `Complete ${target} levels in a row`,
      target: () => 3 + Math.floor(Math.random() * 3), // 3 to 5
      progressTracker: stats => stats.consecutiveLevels
    }
  ];

  // Computed Signals
  currentDifficultySettings = computed(() => this.difficultySettings[this.difficulty()]);
  tileColors = computed(() => this.palettes[this.selectedPaletteIndex()].colors);
  currentPaletteName = computed(() => this.palettes[this.selectedPaletteIndex()].name);

  constructor() {
    this.loadSettings();
    this.initializeDailyTask();

    effect(() => {
      this.saveSettings();
    });
  }

  ngOnInit(): void {
    this.initializeMiniAppSDK();
  }

  private async initializeMiniAppSDK() {
    // The MiniApp SDK is loaded from a script tag in index.html
    const MiniApp = (window as any).MiniApp;
    if (typeof MiniApp !== 'undefined') {
      try {
        // Small delay so loading screen is visible
        await this.delay(750);
        // Signal to the Farcaster client that the MiniApp is ready.
        MiniApp.ready();
        
        const userData = await MiniApp.getUserData();
        if (userData) {
          this.farcasterUser.set(userData);
        }
      } catch (error) {
        console.error('Failed to initialize MiniApp SDK or get user data:', error);
      } finally {
        this.gameState.set('start');
      }
    } else {
      // If not in a Farcaster client, just start the game after a short delay
      await this.delay(750);
      this.gameState.set('start');
    }
  }

  loadSettings() {
    this.highScore.set(Number(localStorage.getItem('colorMemoryHighScore') || 0));
    const savedDifficulty = localStorage.getItem('colorMemoryDifficulty') as Difficulty;
    if (savedDifficulty) this.difficulty.set(savedDifficulty);
    const savedPalette = localStorage.getItem('colorMemoryPalette');
    if (savedPalette) this.selectedPaletteIndex.set(Number(savedPalette));
    const savedMute = localStorage.getItem('colorMemoryMuted');
    this.isMuted.set(savedMute === 'true');
    const savedMode = localStorage.getItem('colorMemoryGameMode') as GameMode;
    if (savedMode) this.gameMode.set(savedMode);
    this.bestZenSequence.set(Number(localStorage.getItem('colorMemoryBestZen') || 0));
  }

  saveSettings() {
    localStorage.setItem('colorMemoryHighScore', this.highScore().toString());
    localStorage.setItem('colorMemoryDifficulty', this.difficulty());
    localStorage.setItem('colorMemoryPalette', this.selectedPaletteIndex().toString());
    localStorage.setItem('colorMemoryMuted', this.isMuted().toString());
    localStorage.setItem('colorMemoryGameMode', this.gameMode());
    localStorage.setItem('colorMemoryBestZen', this.bestZenSequence().toString());
    const task = this.dailyTask();
    if (task) {
      localStorage.setItem('colorMemoryDailyTask', JSON.stringify(task));
    }
  }

  // --- Daily Task Logic ---
  initializeDailyTask() {
    const today = new Date().toISOString().slice(0, 10);
    const lastTaskDate = localStorage.getItem('colorMemoryTaskDate');
    
    if (lastTaskDate !== today) {
      this.generateNewDailyTask(today);
    } else {
      const storedTask = localStorage.getItem('colorMemoryDailyTask');
      if (storedTask) {
        this.dailyTask.set(JSON.parse(storedTask));
      } else {
        this.generateNewDailyTask(today);
      }
    }
  }

  generateNewDailyTask(date: string) {
    const taskDefinition = this.taskDefinitions[Math.floor(Math.random() * this.taskDefinitions.length)];
    const target = taskDefinition.target();
    const newTask: DailyTask = {
      id: taskDefinition.id,
      description: taskDefinition.description(target),
      target: target,
      progress: 0,
      completed: false,
    };
    this.dailyTask.set(newTask);
    localStorage.setItem('colorMemoryTaskDate', date);
    localStorage.setItem('colorMemoryDailyTask', JSON.stringify(newTask));
  }

  updateTaskProgress() {
    if (this.gameMode() === 'zen') return; // Tasks are for classic mode only

    const task = this.dailyTask();
    if (!task || task.completed) return;

    const taskDefinition = this.taskDefinitions.find(t => t.id === task.id);
    if (!taskDefinition) return;

    const gameStats: GameStats = {
      score: this.score(),
      consecutiveLevels: this.consecutiveLevels(),
    };
    
    const newProgress = taskDefinition.progressTracker(gameStats);
    
    // Only update if progress has increased
    if (newProgress > task.progress) {
      task.progress = Math.min(newProgress, task.target);
      
      if (task.progress >= task.target && !task.completed) {
        task.completed = true;
        this.taskJustCompleted.set(true);
        this.score.update(s => s + 500); // Award bonus
      }

      this.dailyTask.set({ ...task });
    }
  }

  // --- Audio Methods ---
  private initializeAudio() {
    if (!this.audioContext && typeof window !== 'undefined') {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
  }

  private playNote(frequency: number, duration: number) {
    if (this.isMuted() || !this.audioContext) return;
    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(this.audioContext.destination);
    gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.4, this.audioContext.currentTime + 0.01);
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
    oscillator.start(this.audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.00001, this.audioContext.currentTime + duration / 1000);
    oscillator.stop(this.audioContext.currentTime + duration / 1000);
  }
  
  private playTileSound(tileIndex: number) {
    const frequencies = [261.63, 293.66, 329.63, 349.23, 392.00, 440.00, 493.88, 523.25, 587.33]; // C Major Scale
    this.playNote(frequencies[tileIndex], 150);
  }

  private playCorrectSound() {
    this.initializeAudio();
    this.playNote(523.25, 100); // C5
    setTimeout(() => this.playNote(659.25, 100), 120); // E5
    setTimeout(() => this.playNote(783.99, 100), 240); // G5
  }
  
  private playMistakeSound() {
    this.initializeAudio();
    this.playNote(130.81, 200); // C3
  }

  private playGameOverSound() {
    this.initializeAudio();
    this.playNote(164.81, 400); // E3
  }
  
  // --- Game Logic ---
  startGame() {
    this.initializeAudio();
    this.sequence.set([]);
    this.playerSequence.set([]);
    this.level.set(0);
    this.taskJustCompleted.set(false);
    
    if (this.gameMode() === 'classic') {
      this.score.set(0);
      this.consecutiveLevels.set(0);
    }
    
    this.gameState.set('showing');
    setTimeout(() => this.nextLevel(), 500);
  }

  nextLevel() {
    this.level.update(l => l + 1);
    
    if (this.gameMode() === 'zen' && this.level() > this.bestZenSequence()) {
      this.bestZenSequence.set(this.level() -1); // Best is completed levels
    }

    this.playerSequence.set([]);
    const newTile = Math.floor(Math.random() * this.GRID_SIZE);
    this.sequence.update(s => [...s, newTile]);
    this.gameState.set('showing');
    this.showSequence();
  }

  async showSequence() {
    const settings = this.currentDifficultySettings();
    await this.delay(settings.sequenceDelay);
    for (const tileIndex of this.sequence()) {
      this.activeTile.set(tileIndex);
      this.playTileSound(tileIndex);
      await this.delay(settings.flashDuration);
      this.activeTile.set(null);
      await this.delay(settings.sequenceDelay / 2);
    }
    this.gameState.set('playing');
  }

  handleTileClick(index: number) {
    if (this.gameState() !== 'playing') return;
    this.initializeAudio();

    this.activeTile.set(index);
    setTimeout(() => this.activeTile.set(null), 150);

    this.playerSequence.update(s => [...s, index]);
    const currentSequence = this.sequence();
    const currentPlayerSequence = this.playerSequence();

    if (currentSequence[currentPlayerSequence.length - 1] !== index) {
      if (this.gameMode() === 'zen') {
        this.handleZenMistake();
      } else {
        this.playGameOverSound();
        this.gameOver();
      }
      return;
    }

    this.playTileSound(index);

    if (currentPlayerSequence.length === currentSequence.length) {
      if (this.gameMode() === 'classic') {
        this.score.update(s => s + (this.level() * 10));
        this.consecutiveLevels.update(c => c + 1);
        this.updateTaskProgress();
      } else { // Zen Mode success
        if (this.level() > this.bestZenSequence()) {
          this.bestZenSequence.set(this.level());
        }
      }
      
      this.gameState.set('showing');
      setTimeout(() => this.playCorrectSound(), 200);
      setTimeout(() => this.nextLevel(), 1000);
    }
  }
  
  private handleZenMistake() {
    this.playMistakeSound();
    this.triggerShake();
    this.playerSequence.set([]);
    this.gameState.set('showing');
    setTimeout(() => this.showSequence(), 500);
  }

  gameOver() {
    this.gameState.set('gameover');
    this.updateTaskProgress(); // Final update for score-based tasks
    if (this.score() > this.highScore()) {
      this.highScore.set(this.score());
    }
    this.triggerShake();
    this.consecutiveLevels.set(0); // Reset for next game
  }
  
  triggerShake() {
    this.isShaking.set(true);
    setTimeout(() => this.isShaking.set(false), 500);
  }

  delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // --- UI Methods ---
  setDifficulty(level: Difficulty) {
    this.difficulty.set(level);
  }
  
  setGameMode(mode: GameMode) {
    this.gameMode.set(mode);
  }

  changePalette(direction: 1 | -1) {
    this.selectedPaletteIndex.update(index => {
      let newIndex = index + direction;
      if (newIndex < 0) newIndex = this.palettes.length - 1;
      if (newIndex >= this.palettes.length) newIndex = 0;
      return newIndex;
    });
  }

  toggleMute() {
    this.isMuted.update(m => !m);
  }
}
