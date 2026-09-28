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

// 游戏规则参数（无压心流模式：无生命惩罚、检查不扣分）
var SUDOKU_GAME_RULES = {
  board_size: 9,
  box_size: 3
};

// 通关评级时间阈值（单位：秒），按难度分别定义。
// 评级综合「用时」与「推导步数是否零浪费」：
//   S+ ：零浪费（步数==需填格数）且用时 <= s_plus
//   S  ：零浪费，或用时 <= s
//   A  ：用时 <= a
//   B  ：其余
var SUDOKU_GRADE_THRESHOLDS = {
  easy: { s_plus: 180, s: 300, a: 480 },
  medium: { s_plus: 360, s: 600, a: 900 },
  hard: { s_plus: 600, s: 900, a: 1500 }
};
