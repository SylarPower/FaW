const PongArenas = {
  neon: {
    id: 'neon',
    name: 'Neon Club',
    bg: '#05060d',
    line: 'rgba(0,255,200,0.28)',
    glow: '#00ffc8'
  },
  dusk: {
    id: 'dusk',
    name: 'Sunset Court',
    bg: '#12080f',
    line: 'rgba(255,43,214,0.28)',
    glow: '#ff2bd6'
  },
  ice: {
    id: 'ice',
    name: 'Ice Rink',
    bg: '#071018',
    line: 'rgba(130,210,255,0.32)',
    glow: '#7ad0ff'
  },
  arcade: {
    id: 'arcade',
    name: 'Arcade',
    bg: '#0a0a12',
    line: 'rgba(255,209,102,0.3)',
    glow: '#ffd166'
  }
};

function listArenas() {
  return Object.values(PongArenas);
}
