// Sudoku Matrix 小工具 - 游戏逻辑
// 基线 ES2017：不使用可选链(?.)、空值合并(??)、对象展开等语法。
// 交互规范：无内联事件，统一 data-action / data-cell / data-digit + 事件委托。

(function () {
  'use strict';

  var SIZE = SUDOKU_GAME_RULES.board_size;
  var BOX = SUDOKU_GAME_RULES.box_size;
  var CELLS = SIZE * SIZE;

  // ---------------- 游戏状态 ----------------
  var game_state = {
    difficulty_key: 'medium',
    puzzle: [],        // 题面（0 表示空格），长度 81
    solution: [],      // 唯一解，长度 81
    values: [],        // 当前盘面，长度 81
    notes: [],         // 每格候选数数组（1-9），长度 81
    is_given: [],      // 是否为预填格，长度 81
    selected_index: -1,
    selected_digit: 0,
    note_mode: false,
    elapsed_seconds: 0,
    steps: 0,          // 本次填对数字的次数（推导步数）
    mistakes: 0,       // 本次填错数字的次数（失误次数）
    note_count: 0,     // 本次笔记模式写入候选的次数
    checked: false,    // 是否点击过「检查」：true 时正确用户格显示 ✓ 角标
    finished: false
  };

  var timer_id = null;
  var toast_timer_id = null;

  // ---------------- DOM 引用 ----------------
  var dom = {
    view_home: document.getElementById('view-home'),
    view_game: document.getElementById('view-game'),
    difficulty_list: document.getElementById('difficulty-list'),
    board_grid: document.getElementById('board-grid'),
    numpad: document.getElementById('numpad'),
    game_timer: document.getElementById('game-timer'),
    difficulty_label: document.getElementById('difficulty-label'),
    note_btn: document.getElementById('note-btn'),
    win_modal: document.getElementById('win-modal'),
    win_subtitle: document.getElementById('win-subtitle'),
    stat_time: document.getElementById('stat-time'),
    stat_best_tag: document.getElementById('stat-best-tag'),
    stat_steps: document.getElementById('stat-steps'),
    stat_mistakes_note: document.getElementById('stat-mistakes-note'),
    stat_notes: document.getElementById('stat-notes'),
    stat_note_rate: document.getElementById('stat-note-rate'),
    stat_grade: document.getElementById('stat-grade'),
    stat_perfect_tag: document.getElementById('stat-perfect-tag'),
    theme_label: document.getElementById('theme-label'),
    zen_label: document.getElementById('zen-label'),
    check_toast: document.getElementById('check-toast')
  };

  var cell_elements = [];

  // ---------------- 数独生成算法 ----------------
  // 生成完整有效终盘：随机化候选 + 回溯
  function generate_full_grid() {
    var grid = [];
    var i;
    for (i = 0; i < CELLS; i += 1) { grid.push(0); }
    fill_grid(grid, 0);
    return grid;
  }

  function fill_grid(grid, pos) {
    if (pos >= CELLS) { return true; }
    var candidates = shuffle_array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    var row = Math.floor(pos / SIZE);
    var col = pos % SIZE;
    var k;
    for (k = 0; k < candidates.length; k += 1) {
      var digit = candidates[k];
      if (is_place_valid(grid, row, col, digit)) {
        grid[pos] = digit;
        if (fill_grid(grid, pos + 1)) { return true; }
        grid[pos] = 0;
      }
    }
    return false;
  }

  function is_place_valid(grid, row, col, digit) {
    var i;
    for (i = 0; i < SIZE; i += 1) {
      if (grid[row * SIZE + i] === digit) { return false; }
      if (grid[i * SIZE + col] === digit) { return false; }
    }
    var box_row = Math.floor(row / BOX) * BOX;
    var box_col = Math.floor(col / BOX) * BOX;
    var r;
    var c;
    for (r = box_row; r < box_row + BOX; r += 1) {
      for (c = box_col; c < box_col + BOX; c += 1) {
        if (grid[r * SIZE + c] === digit) { return false; }
      }
    }
    return true;
  }

  // 统计解的个数（上限 limit，超过即返回），用于保证唯一解
  function count_solutions(grid, limit) {
    var best_count = 0;
    var best_pos = -1;
    var min_options = SIZE + 1;
    var pos, row, col, digit, options;
    for (pos = 0; pos < CELLS; pos += 1) {
      if (grid[pos] !== 0) { continue; }
      options = 0;
      row = Math.floor(pos / SIZE);
      col = pos % SIZE;
      for (digit = 1; digit <= 9; digit += 1) {
        if (is_place_valid(grid, row, col, digit)) { options += 1; }
      }
      if (options === 0) { return 0; }
      if (options < min_options) {
        min_options = options;
        best_pos = pos;
        if (options === 1) { break; }
      }
    }
    if (best_pos === -1) { return 1; } // 已全部填满
    row = Math.floor(best_pos / SIZE);
    col = best_pos % SIZE;
    for (digit = 1; digit <= 9; digit += 1) {
      if (!is_place_valid(grid, row, col, digit)) { continue; }
      grid[best_pos] = digit;
      best_count += count_solutions(grid, limit - best_count);
      grid[best_pos] = 0;
      if (best_count >= limit) { return best_count; }
    }
    return best_count;
  }

  // 从终盘挖洞：逐格尝试删除，保持唯一解
  function build_puzzle(target_givens) {
    var solution = generate_full_grid();
    var puzzle = solution.slice();
    var order = [];
    var i;
    for (i = 0; i < CELLS; i += 1) { order.push(i); }
    order = shuffle_array(order);
    var removed = 0;
    var target_removed = CELLS - target_givens;
    var k;
    for (k = 0; k < order.length && removed < target_removed; k += 1) {
      var idx = order[k];
      var backup = puzzle[idx];
      puzzle[idx] = 0;
      var probe = puzzle.slice();
      if (count_solutions(probe, 2) !== 1) {
        puzzle[idx] = backup;
      } else {
        removed += 1;
      }
    }
    return { puzzle: puzzle, solution: solution };
  }

  function shuffle_array(arr) {
    var i;
    var j;
    var tmp;
    for (i = arr.length - 1; i > 0; i -= 1) {
      j = Math.floor(Math.random() * (i + 1));
      tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  // ---------------- 本地缓存（进度持久化） ----------------
  // 优先使用容器 Storage API（客户端 9.46+），低版本/非容器环境回退 localStorage。
  // 读写失败均静默降级，容忍进度丢失，不影响游戏进行。
  var SAVE_KEY = 'sudoku_save_v1';
  var STORAGE_MIN_CLIENT_VERSION = 9460;

  function get_client_version(build_version) {
    return Math.floor((Number(build_version) || 0) / 1000);
  }

  function read_build_version(launch_options) {
    var mini_tool_env = launch_options && launch_options.miniToolEnv;
    return Number(mini_tool_env && mini_tool_env.buildVersion) || 0;
  }

  function get_build_version() {
    var xhs = window.xhs;
    var sync_version = read_build_version(xhs && xhs.launchOptions);
    if (sync_version) { return Promise.resolve(sync_version); }
    var mini_tool = xhs && xhs.miniTool;
    if (!mini_tool || typeof mini_tool.getLaunchOptions !== 'function') {
      return Promise.resolve(0);
    }
    return mini_tool.getLaunchOptions()
      .then(read_build_version)
      .catch(function () { return 0; });
  }

  function get_mini_tool() {
    var xhs = window.xhs;
    return xhs && xhs.miniTool ? xhs.miniTool : null;
  }

  function local_set(key, serialized) {
    try {
      window.localStorage.setItem(key, serialized);
      return true;
    } catch (error) {
      return false;
    }
  }

  function local_get(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function local_remove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (error) {
      // 忽略：清不掉也不影响游戏
    }
  }

  // 写入缓存：9.46+ 用容器 Storage，否则回退 localStorage
  function storage_set(key, value) {
    var serialized;
    try {
      serialized = JSON.stringify(value);
    } catch (error) {
      return;
    }
    var mini_tool = get_mini_tool();
    if (mini_tool && typeof mini_tool.setStorage === 'function') {
      get_build_version().then(function (build_version) {
        if (get_client_version(build_version) >= STORAGE_MIN_CLIENT_VERSION) {
          mini_tool.setStorage({ key: key, data: serialized })
            .catch(function () { local_set(key, serialized); });
        } else {
          local_set(key, serialized);
        }
      });
      return;
    }
    local_set(key, serialized);
  }

  // 读取缓存：返回 Promise<string|null>
  function storage_get(key) {
    var mini_tool = get_mini_tool();
    if (mini_tool && typeof mini_tool.getStorage === 'function') {
      return get_build_version().then(function (build_version) {
        if (get_client_version(build_version) >= STORAGE_MIN_CLIENT_VERSION) {
          return mini_tool.getStorage({ key: key }).then(function (result) {
            var data = result && result.data;
            return typeof data === 'string' ? data : local_get(key);
          });
        }
        return local_get(key);
      }).catch(function () {
        return local_get(key);
      });
    }
    return Promise.resolve(local_get(key));
  }

  function storage_remove(key) {
    var mini_tool = get_mini_tool();
    if (mini_tool && typeof mini_tool.removeStorage === 'function') {
      get_build_version().then(function (build_version) {
        if (get_client_version(build_version) >= STORAGE_MIN_CLIENT_VERSION) {
          mini_tool.removeStorage({ key: key })
            .catch(function () { local_remove(key); });
        } else {
          local_remove(key);
        }
      });
      return;
    }
    local_remove(key);
  }

  // 保存当前对局（游戏进行中才写；未开局不写）
  function persist_game() {
    if (!game_state.puzzle.length || game_state.finished) { return; }
    storage_set(SAVE_KEY, {
      version: 4,
      difficulty_key: game_state.difficulty_key,
      puzzle: game_state.puzzle,
      solution: game_state.solution,
      values: game_state.values,
      notes: game_state.notes,
      elapsed_seconds: game_state.elapsed_seconds,
      steps: game_state.steps,
      mistakes: game_state.mistakes,
      note_count: game_state.note_count
    });
  }

  function clear_saved_game() {
    storage_remove(SAVE_KEY);
  }

  // 校验缓存数据完整性与一致性，不合法则视为无缓存
  function is_valid_save(save) {
    if (!save || save.version !== 4) {
      return false; // 报错原因：存档版本非 v4（v3 及更早缺少失误次数字段，无法推导），按无缓存处理并清除
    }
    if (!Array.isArray(save.puzzle) || save.puzzle.length !== CELLS) { return false; }
    if (!Array.isArray(save.solution) || save.solution.length !== CELLS) { return false; }
    if (!Array.isArray(save.values) || save.values.length !== CELLS) { return false; }
    if (!Array.isArray(save.notes) || save.notes.length !== CELLS) { return false; }
    var i;
    for (i = 0; i < CELLS; i += 1) {
      var given = save.puzzle[i];
      var answer = save.solution[i];
      var value = save.values[i];
      if (typeof given !== 'number' || given < 0 || given > 9) { return false; }
      if (typeof answer !== 'number' || answer < 1 || answer > 9) { return false; }
      if (typeof value !== 'number' || value < 0 || value > 9) { return false; }
      if (given > 0 && value !== given) {
        return false; // 报错原因：题面预填数字与盘面不一致，缓存被篡改或损坏
      }
      if (!Array.isArray(save.notes[i])) { return false; }
    }
    if (typeof save.elapsed_seconds !== 'number' || save.elapsed_seconds < 0) { return false; }
    if (typeof save.steps !== 'number' || save.steps < 0) {
      return false; // 报错原因：推导步数字段缺失或非法，缓存被篡改或损坏
    }
    if (typeof save.mistakes !== 'number' || save.mistakes < 0) {
      return false; // 报错原因：失误次数字段缺失或非法，缓存被篡改或损坏
    }
    if (typeof save.note_count !== 'number' || save.note_count < 0) {
      return false; // 报错原因：笔记次数字段缺失或非法，缓存被篡改或损坏
    }
    for (i = 0; i < CELLS; i += 1) {
      if (save.values[i] !== save.solution[i]) { return true; } // 有未完成格子，可恢复
    }
    return false; // 报错原因：盘面已全部正确，无需恢复
  }

  // 从缓存恢复对局并直接进入游戏页
  function restore_saved_game(save) {
    game_state.difficulty_key = save.difficulty_key;
    game_state.puzzle = save.puzzle;
    game_state.solution = save.solution;
    game_state.values = save.values;
    game_state.notes = save.notes;
    game_state.is_given = [];
    var i;
    for (i = 0; i < CELLS; i += 1) {
      game_state.is_given.push(game_state.puzzle[i] > 0);
    }
    game_state.selected_index = -1;
    game_state.selected_digit = 0;
    game_state.note_mode = false;
    game_state.elapsed_seconds = save.elapsed_seconds;
    game_state.steps = save.steps;
    game_state.mistakes = save.mistakes;
    game_state.note_count = save.note_count;
    game_state.finished = false;

    dom.difficulty_label.textContent = get_difficulty(save.difficulty_key).label;
    dom.win_modal.hidden = true;
    dom.view_home.hidden = true;
    dom.view_game.hidden = false;
    window.scrollTo(0, 0);
    render_all();
    start_timer();
    show_toast('已恢复上次未完成的对局');
  }

  // 进入页面时检查缓存
  function resume_saved_game_if_exists() {
    storage_get(SAVE_KEY).then(function (raw) {
      if (!raw) { return null; }
      var save = null;
      try {
        save = JSON.parse(raw);
      } catch (error) {
        clear_saved_game(); // 缓存不是合法 JSON，直接清掉
        return null;
      }
      if (!is_valid_save(save)) {
        clear_saved_game(); // 数据不完整或与题面矛盾，按无缓存处理
        return null;
      }
      return save;
    }).then(function (save) {
      if (save) { restore_saved_game(save); }
    });
  }

  // ---------------- 工具函数 ----------------
  function format_seconds(total_seconds) {
    var mins = Math.floor(total_seconds / 60);
    var secs = total_seconds % 60;
    return (mins < 10 ? '0' + mins : '' + mins) + ':' + (secs < 10 ? '0' + secs : '' + secs);
  }

  function get_difficulty(key) {
    var i;
    for (i = 0; i < SUDOKU_DIFFICULTY_OPTIONS.length; i += 1) {
      if (SUDOKU_DIFFICULTY_OPTIONS[i].key === key) {
        return SUDOKU_DIFFICULTY_OPTIONS[i];
      }
    }
    return SUDOKU_DIFFICULTY_OPTIONS[1];
  }

  function digit_remaining(digit) {
    var count = 0;
    var i;
    for (i = 0; i < CELLS; i += 1) {
      if (game_state.values[i] === digit) { count += 1; }
    }
    return 9 - count;
  }

  // ---------------- 渲染 ----------------
  function build_board_dom() {
    dom.board_grid.innerHTML = '';
    cell_elements = [];
    var i;
    for (i = 0; i < CELLS; i += 1) {
      var row = Math.floor(i / SIZE);
      var col = i % SIZE;
      var cell = document.createElement('div');
      var cls = 'cell';
      if (col === 2 || col === 5) { cls += ' box-right'; }
      if (row === 2 || row === 5) { cls += ' box-bottom'; }
      if (col === 8) { cls += ' last-col'; }
      if (row === 8) { cls += ' last-row'; }
      cell.className = cls;
      cell.setAttribute('data-cell', String(i));

      var inner = document.createElement('div');
      inner.className = 'cell-inner';
      var num = document.createElement('span');
      num.className = 'cell-num';
      inner.appendChild(num);
      cell.appendChild(inner);

      var notes = document.createElement('div');
      notes.className = 'cell-notes';
      notes.hidden = true;
      var n;
      for (n = 1; n <= 9; n += 1) {
        var note_span = document.createElement('span');
        note_span.className = 'cell-note';
        note_span.setAttribute('data-note-slot', String(n));
        notes.appendChild(note_span);
      }
      cell.appendChild(notes);

      dom.board_grid.appendChild(cell);
      cell_elements.push(cell);
    }
  }

  function update_board() {
    var selected_value = 0;
    if (game_state.selected_index >= 0) {
      selected_value = game_state.values[game_state.selected_index];
    }
    var sel_row = game_state.selected_index >= 0 ? Math.floor(game_state.selected_index / SIZE) : -1;
    var sel_col = game_state.selected_index >= 0 ? game_state.selected_index % SIZE : -1;
    var sel_box_r = sel_row >= 0 ? Math.floor(sel_row / BOX) * BOX : -1;
    var sel_box_c = sel_col >= 0 ? Math.floor(sel_col / BOX) * BOX : -1;

    var i;
    for (i = 0; i < CELLS; i += 1) {
      var cell = cell_elements[i];
      var row = Math.floor(i / SIZE);
      var col = i % SIZE;
      var value = game_state.values[i];
      var num_el = cell.querySelector('.cell-num');
      var notes_el = cell.querySelector('.cell-notes');

      // 基础类名保留 box/last 部分
      var base_cls = 'cell';
      if (col === 2 || col === 5) { base_cls += ' box-right'; }
      if (row === 2 || row === 5) { base_cls += ' box-bottom'; }
      if (col === 8) { base_cls += ' last-col'; }
      if (row === 8) { base_cls += ' last-row'; }
      var extra = [];

      if (game_state.selected_index >= 0 && !game_state.finished) {
        var in_box = row >= sel_box_r && row < sel_box_r + BOX && col >= sel_box_c && col < sel_box_c + BOX;
        if (row === sel_row || col === sel_col || in_box) { extra.push('is-crosshair'); }
      }
      if (i === game_state.selected_index) { extra.push('is-selected'); }
      if (selected_value > 0 && value === selected_value && i !== game_state.selected_index) {
        extra.push('is-same-digit');
      }
      if (value > 0 && value !== game_state.solution[i]) { extra.push('is-error-cell'); }
      // 色弱友好：检查后正确的用户填格加 ✓ 角标（形状线索，与 ✕ 对称）
      if (value > 0 && !game_state.is_given[i] && value === game_state.solution[i] && game_state.checked) {
        extra.push('is-correct-cell');
      }
      cell.className = base_cls + (extra.length ? ' ' + extra.join(' ') : '');

      // 数字
      num_el.textContent = value > 0 ? String(value) : '';
      var num_cls = 'cell-num';
      if (value > 0) {
        if (game_state.is_given[i]) { num_cls += ' is-given'; }
        else { num_cls += ' is-user'; }
        if (value !== game_state.solution[i]) { num_cls += ' is-error'; }
        else if (selected_value === value && i !== game_state.selected_index) { num_cls += ' is-same'; }
      }
      num_el.className = num_cls;

      // 笔记
      var note_list = game_state.notes[i];
      if (value === 0 && note_list.length > 0) {
        notes_el.hidden = false;
        var slots = notes_el.children;
        var s;
        for (s = 0; s < 9; s += 1) {
          slots[s].textContent = note_list.indexOf(s + 1) >= 0 ? String(s + 1) : '';
        }
      } else {
        notes_el.hidden = true;
      }
    }
  }

  function build_numpad() {
    dom.numpad.innerHTML = '';
    var d;
    for (d = 1; d <= 9; d += 1) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'num-key';
      btn.setAttribute('data-digit', String(d));

      var val = document.createElement('span');
      val.className = 'num-key-value';
      val.textContent = String(d);
      btn.appendChild(val);

      var cnt = document.createElement('span');
      cnt.className = 'num-key-count';
      btn.appendChild(cnt);

      dom.numpad.appendChild(btn);
    }
  }

  function update_numpad() {
    var keys = dom.numpad.children;
    var d;
    for (d = 0; d < 9; d += 1) {
      var digit = d + 1;
      var btn = keys[d];
      var remaining = digit_remaining(digit);
      var cnt_el = btn.querySelector('.num-key-count');
      var cls = 'num-key';
      if (remaining <= 0) {
        cls += ' is-exhausted';
        btn.disabled = true;
        cnt_el.textContent = '已满';
      } else {
        btn.disabled = false;
        cnt_el.textContent = '余' + remaining;
        if (digit === game_state.selected_digit) { cls += ' is-selected'; }
      }
      btn.className = cls;
    }
  }

  function update_status_bar() {
    dom.game_timer.textContent = format_seconds(game_state.elapsed_seconds);
    // 标记按钮开启态：主色高亮 + 角标圆点变色
    if (game_state.note_mode) { dom.note_btn.classList.add('note-on'); }
    else { dom.note_btn.classList.remove('note-on'); }
  }

  function render_all() {
    update_board();
    update_numpad();
    update_status_bar();
  }

  // ---------------- 计时 ----------------
  function start_timer() {
    stop_timer();
    timer_id = window.setInterval(function () {
      if (game_state.finished) { return; }
      game_state.elapsed_seconds += 1;
      dom.game_timer.textContent = format_seconds(game_state.elapsed_seconds);
    }, 1000);
  }

  function stop_timer() {
    if (timer_id !== null) {
      window.clearInterval(timer_id);
      timer_id = null;
    }
  }

  // ---------------- 游戏流程 ----------------
  function start_game(difficulty_key) {
    var option = get_difficulty(difficulty_key);
    clear_saved_game();
    game_state.difficulty_key = option.key;
    var built = build_puzzle(option.given_count);
    game_state.puzzle = built.puzzle;
    game_state.solution = built.solution;
    game_state.values = built.puzzle.slice();
    game_state.notes = [];
    game_state.is_given = [];
    var i;
    for (i = 0; i < CELLS; i += 1) {
      game_state.notes.push([]);
      game_state.is_given.push(game_state.puzzle[i] > 0);
    }
    game_state.selected_index = -1;
    game_state.selected_digit = 0;
    game_state.note_mode = false;
    game_state.elapsed_seconds = 0;
    game_state.steps = 0;
    game_state.mistakes = 0;
    game_state.note_count = 0;
    game_state.checked = false;
    game_state.finished = false;

    dom.difficulty_label.textContent = option.label;
    dom.win_modal.hidden = true;

    dom.view_home.hidden = true;
    dom.view_game.hidden = false;
    window.scrollTo(0, 0);
    render_all();
    start_timer();
  }

  function back_home() {
    stop_timer();
    dom.view_game.hidden = true;
    dom.view_home.hidden = false;
    dom.win_modal.hidden = true;
  }

  function select_cell(index) {
    if (game_state.finished) { return; }
    game_state.selected_index = index;
    var value = game_state.values[index];
    if (value > 0) { game_state.selected_digit = value; }
    render_all();
  }

  function input_digit(digit) {
    if (game_state.finished) { return; }
    game_state.selected_digit = digit;
    var index = game_state.selected_index;
    if (index < 0) {
      // 未选中格子时自动选中第一个匹配该数字可填的空格
      var first_empty = -1;
      var i;
      for (i = 0; i < CELLS; i += 1) {
        if (game_state.values[i] === 0) {
          if (first_empty < 0) { first_empty = i; }
          if (digit === game_state.solution[i]) { first_empty = i; break; }
        }
      }
      if (first_empty < 0) { render_all(); return; }
      index = first_empty;
      game_state.selected_index = index;
    }
    if (game_state.is_given[index]) { render_all(); return; }

    if (game_state.note_mode) {
      toggle_note(index, digit);
    } else {
      set_value(index, digit);
    }
    render_all();
    check_win();
    persist_game();
  }

  function set_value(index, digit) {
    if (game_state.values[index] === digit) { return; }
    game_state.values[index] = digit;
    game_state.notes[index] = [];
    // 统计口径：每次「填入正确数字」计 1 步推导；填入错误数字计 1 次失误
    if (digit === game_state.solution[index]) { game_state.steps += 1; }
    else { game_state.mistakes += 1; }
    var num_el = cell_elements[index].querySelector('.cell-num');
    num_el.classList.add('pop-in');
    window.setTimeout(function () { num_el.classList.remove('pop-in'); }, 200);
  }

  function toggle_note(index, digit) {
    if (game_state.values[index] > 0) { return; }
    var notes = game_state.notes[index].slice();
    var pos = notes.indexOf(digit);
    if (pos >= 0) { notes.splice(pos, 1); }
    else {
      notes.push(digit);
      notes.sort(function (a, b) { return a - b; });
      // 统计口径：笔记模式下每「写入」一个候选数计 1 次（擦除候选不计数）
      game_state.note_count += 1;
    }
    game_state.notes[index] = notes;
  }

  function erase_cell() {
    if (game_state.finished) { return; }
    var index = game_state.selected_index;
    if (index < 0 || game_state.is_given[index]) { return; }
    if (game_state.values[index] === 0 && game_state.notes[index].length === 0) { return; }
    game_state.values[index] = 0;
    game_state.notes[index] = [];
    render_all();
    persist_game();
  }

  // 检查全盘：红底+✕ 高亮填错格子并 toast 提示数量，全对则提示全部正确；
  // 检查后正确的用户填格持续显示天蓝底+✓ 角标（形状线索，色弱友好）。
  // 心流玩法：不扣命、不判负、不计入任何统计。
  function check_board() {
    if (game_state.finished) { return; }
    game_state.checked = true;
    var error_count = 0;
    var i;
    for (i = 0; i < CELLS; i += 1) {
      if (game_state.values[i] > 0 && game_state.values[i] !== game_state.solution[i]) {
        error_count += 1;
      }
    }
    render_all(); // is-error-cell 类会在 update_board 中刷新高亮
    if (error_count > 0) {
      show_toast('有 ' + error_count + ' 处错误');
    } else {
      show_toast('当前全部正确');
    }
  }

  function check_win() {
    if (game_state.finished) { return; }
    var i;
    for (i = 0; i < CELLS; i += 1) {
      if (game_state.values[i] !== game_state.solution[i]) { return; }
    }
    game_state.finished = true;
    stop_timer();
    clear_saved_game();
    show_win_stats();
    dom.win_modal.hidden = false;
  }

  // ---------------- 通关结算统计 ----------------
  // 按难度持久化历史最佳用时（秒），key -> 最小秒数
  var BEST_KEY = 'sudoku_best_v1';

  function load_best_map(callback) {
    storage_get(BEST_KEY).then(function (raw) {
      var map = {};
      if (raw) {
        try {
          var parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') { map = parsed; }
        } catch (error) {
          // 报错原因：历史最佳缓存非法 JSON，按无记录处理并覆盖
          storage_remove(BEST_KEY);
        }
      }
      callback(map);
    });
  }

  // 评级：综合用时阈值与「零失误」（填错次数为 0）
  function compute_grade(elapsed, mistakes, difficulty_key) {
    var thresholds = SUDOKU_GRADE_THRESHOLDS[difficulty_key];
    if (!thresholds) { thresholds = SUDOKU_GRADE_THRESHOLDS.medium; }
    var zero_waste = mistakes === 0;
    if (zero_waste && elapsed <= thresholds.s_plus) { return 'S+'; }
    if (zero_waste || elapsed <= thresholds.s) { return 'S'; }
    if (elapsed <= thresholds.a) { return 'A'; }
    return 'B';
  }

  function show_win_stats() {
    var option = get_difficulty(game_state.difficulty_key);
    dom.win_subtitle.textContent = option.label + ' · 纯净通关';
    dom.stat_time.textContent = format_seconds(game_state.elapsed_seconds);
    dom.stat_steps.textContent = String(game_state.steps);
    // 失误次数：填错数字的真实计数（含填错后擦除重填）
    dom.stat_mistakes_note.textContent = '失误 ' + game_state.mistakes + ' 次';
    dom.stat_notes.textContent = String(game_state.note_count);
    var rate = game_state.steps > 0
      ? Math.round(game_state.note_count / game_state.steps * 100)
      : 0;
    dom.stat_note_rate.textContent = '辅助标记率 ' + rate + '%';
    dom.stat_grade.textContent = compute_grade(
      game_state.elapsed_seconds, game_state.mistakes, game_state.difficulty_key
    );
    // 零失误达成：全程填错次数为 0
    dom.stat_perfect_tag.hidden = game_state.mistakes !== 0;

    // 历史最佳：比各难度最小用时速则刷新并写回
    dom.stat_best_tag.hidden = true;
    load_best_map(function (map) {
      var prev_best = Number(map[game_state.difficulty_key]);
      var is_best = !(prev_best > 0) || game_state.elapsed_seconds < prev_best;
      dom.stat_best_tag.hidden = !is_best;
      if (is_best) {
        map[game_state.difficulty_key] = game_state.elapsed_seconds;
        storage_set(BEST_KEY, map);
      }
    });
  }

  // ---------------- 日夜主题 ----------------
  var THEME_KEY = 'sudoku_theme_v1';

  function apply_theme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    // 按钮展示当前模式（对齐设计稿）：日间=太阳+「日间」，夜间=月亮+「夜间」
    dom.theme_label.textContent = theme === 'dark' ? '夜间' : '日间';
    // 状态栏第三胶囊（对齐设计稿）：日间=「心流禅模式」，夜间=「WCAG AA」
    dom.zen_label.textContent = theme === 'dark' ? 'WCAG AA' : '心流禅模式';
  }

  function toggle_theme() {
    var current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    var next = current === 'dark' ? 'light' : 'dark';
    apply_theme(next);
    storage_set(THEME_KEY, next);
  }

  function restore_theme() {
    storage_get(THEME_KEY).then(function (raw) {
      var theme = 'light';
      try {
        // storage_set 写入时已 JSON 序列化，这里需反解后再比较
        if (JSON.parse(raw) === 'dark') { theme = 'dark'; }
      } catch (error) {
        // 报错原因：主题缓存非法 JSON，按默认日间模式处理
      }
      apply_theme(theme);
    });
  }

  // ---------------- Toast ----------------
  function show_toast(message) {
    dom.check_toast.textContent = message;
    dom.check_toast.hidden = false;
    if (toast_timer_id !== null) { window.clearTimeout(toast_timer_id); }
    toast_timer_id = window.setTimeout(function () {
      dom.check_toast.hidden = true;
      toast_timer_id = null;
    }, 2200);
  }

  // ---------------- 首页渲染 ----------------
  function render_home() {
    dom.difficulty_list.innerHTML = '';
    var i;
    for (i = 0; i < SUDOKU_DIFFICULTY_OPTIONS.length; i += 1) {
      var option = SUDOKU_DIFFICULTY_OPTIONS[i];
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'difficulty-card' + (option.key === game_state.difficulty_key ? ' is-selected' : '');
      card.setAttribute('data-difficulty', option.key);

      var main = document.createElement('span');
      main.className = 'difficulty-card-main';
      var label = document.createElement('span');
      label.className = 'difficulty-card-label';
      label.textContent = option.label;
      var desc = document.createElement('span');
      desc.className = 'difficulty-card-desc';
      desc.textContent = option.description;
      main.appendChild(label);
      main.appendChild(desc);

      var radio = document.createElement('span');
      radio.className = 'difficulty-card-radio';

      card.appendChild(main);
      card.appendChild(radio);
      dom.difficulty_list.appendChild(card);
    }
  }

  // ---------------- 事件绑定（事件委托） ----------------
  function bind_actions() {
    document.body.addEventListener('click', function (event) {
      var target = event.target;
      if (!target || !target.closest) { return; }

      // 难度卡片
      var diff_card = target.closest('[data-difficulty]');
      if (diff_card && dom.difficulty_list.contains(diff_card)) {
        var key = diff_card.getAttribute('data-difficulty');
        game_state.difficulty_key = key;
        render_home();
        return;
      }

      // 棋盘格子
      var cell_el = target.closest('[data-cell]');
      if (cell_el && dom.board_grid.contains(cell_el)) {
        select_cell(parseInt(cell_el.getAttribute('data-cell'), 10));
        return;
      }

      // 数字键盘
      var digit_el = target.closest('[data-digit]');
      if (digit_el && dom.numpad.contains(digit_el)) {
        var digit = parseInt(digit_el.getAttribute('data-digit'), 10);
        if (digit_remaining(digit) > 0) { input_digit(digit); }
        return;
      }

      // 统一 data-action
      var action_el = target.closest('[data-action]');
      if (!action_el) { return; }
      var action = action_el.getAttribute('data-action');
      switch (action) {
        case 'start-game':
          start_game(game_state.difficulty_key);
          break;
        case 'back-home':
          back_home();
          break;
        case 'restart-game':
          start_game(game_state.difficulty_key);
          break;
        case 'erase':
          erase_cell();
          break;
        case 'toggle-note':
          game_state.note_mode = !game_state.note_mode;
          render_all();
          break;
        case 'check-board':
          check_board();
          break;
        case 'toggle-theme':
          toggle_theme();
          break;
        case 'win-back-home':
          back_home();
          break;
        case 'win-next-round':
          start_game(game_state.difficulty_key);
          break;
        default:
          break;
      }
    });
  }

  // ---------------- 启动 ----------------
  function init() {
    build_board_dom();
    build_numpad();
    render_home();
    bind_actions();
    restore_theme();
    resume_saved_game_if_exists();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
