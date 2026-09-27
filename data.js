// Sudoku Matrix 小工具 - 数据配置（难度参数与游戏规则）

// 三档难度：预填数字数量符合 PRD 要求
var SUDOKU_DIFFICULTY_OPTIONS = [
  {
    key: 'easy',
    label: '简单难度',
    description: '预填 45-50 个数字',
    given_count: 46
  },
  {
    key: 'medium',
    label: '中等难度',
    description: '预填 35-40 个数字',
    given_count: 37
  },
  {
    key: 'hard',
    label: '困难难度',
    description: '预填 25-30 个数字',
    given_count: 27
  }
];

// 游戏规则参数（无压心流模式：无生命惩罚、提示不限次数）
var SUDOKU_GAME_RULES = {
  board_size: 9,
  box_size: 3
};
