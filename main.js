// 数独小工具 - 游戏逻辑
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
    mistakes: 0,
    hints_left: SUDOKU_GAME_RULES.max_hints,
    elapsed_seconds: 0,
    paused: false,
    finished: false
  };

  var undo_stack = [];
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
    mistake_label: document.getElementById('mistake-label'),
    note_icon: document.getElementById('note-icon'),
    note_badge: document.getElementById('note-badge'),
    note_label: document.getElementById('note-label'),
    hint_badge: document.getElementById('hint-badge'),
    pause_overlay: document.getElementById('pause-overlay'),
    win_modal: document.getElementById('win-modal'),
    win_time: document.getElementById('win-time'),
    win_mistakes: document.getElementById('win-mistakes'),
    lose_modal: document.getElementById('lose-modal'),
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
      version: 1,
      difficulty_key: game_state.difficulty_key,
      puzzle: game_state.puzzle,
      solution: game_state.solution,
      values: game_state.values,
      notes: game_state.notes,
      mistakes: game_state.mistakes,
      hints_left: game_state.hints_left,
      elapsed_seconds: game_state.elapsed_seconds
    });
  }

  function clear_saved_game() {
    storage_remove(SAVE_KEY);
  }

  // 校验缓存数据完整性与一致性，不合法则视为无缓存
  function is_valid_save(save) {
    if (!save || save.version !== 1) { return false; }
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
    if (typeof save.mistakes !== 'number' || save.mistakes < 0 || save.mistakes >= SUDOKU_GAME_RULES.max_mistakes) {
      return false; // 报错原因：错误次数已达结束条件，属于已结束对局
    }
    if (typeof save.hints_left !== 'number' || save.hints_left < 0 || save.hints_left > SUDOKU_GAME_RULES.max_hints) { return false; }
    if (typeof save.elapsed_seconds !== 'number' || save.elapsed_seconds < 0) { return false; }
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
    game_state.mistakes = save.mistakes;
    game_state.hints_left = save.hints_left;
    game_state.elapsed_seconds = save.elapsed_seconds;
    game_state.paused = false;
    game_state.finished = false;
    undo_stack = [];

    dom.difficulty_label.textContent = get_difficulty(save.difficulty_key).label;
    dom.pause_overlay.hidden = true;
    dom.win_modal.hidden = true;
    dom.lose_modal.hidden = true;
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

  function push_undo(index) {
    undo_stack.push({
      index: index,
      prev_value: game_state.values[index],
      prev_notes: game_state.notes[index].slice(),
      prev_mistakes: game_state.mistakes
    });
    if (undo_stack.length > 200) { undo_stack.shift(); }
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
        cnt_el.textContent = '已填满';
      } else {
        btn.disabled = false;
        cnt_el.textContent = '余 ' + remaining;
        if (digit === game_state.selected_digit) { cls += ' is-selected'; }
      }
      btn.className = cls;
    }
  }

  function update_status_bar() {
    dom.game_timer.textContent = format_seconds(game_state.elapsed_seconds);
    dom.mistake_label.textContent = game_state.mistakes + '/' + SUDOKU_GAME_RULES.max_mistakes;
    dom.hint_badge.textContent = String(game_state.hints_left);
    if (game_state.hints_left <= 0) {
      dom.hint_badge.classList.add('is-hidden');
    } else {
      dom.hint_badge.classList.remove('is-hidden');
    }
    var note_on = game_state.note_mode;
    if (note_on) {
      dom.note_icon.classList.add('is-active');
      dom.note_badge.textContent = '开';
      dom.note_badge.classList.remove('is-hidden');
    } else {
      dom.note_icon.classList.remove('is-active');
      dom.note_badge.classList.add('is-hidden');
    }
    var note_btn = dom.note_icon.parentNode;
    if (note_on) { note_btn.classList.add('note-on'); }
    else { note_btn.classList.remove('note-on'); }
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
      if (game_state.paused || game_state.finished) { return; }
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
    game_state.mistakes = 0;
    game_state.hints_left = SUDOKU_GAME_RULES.max_hints;
    game_state.elapsed_seconds = 0;
    game_state.paused = false;
    game_state.finished = false;
    undo_stack = [];

    dom.difficulty_label.textContent = option.label;
    dom.pause_overlay.hidden = true;
    dom.win_modal.hidden = true;
    dom.lose_modal.hidden = true;

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
    dom.lose_modal.hidden = true;
    dom.pause_overlay.hidden = true;
  }

  function select_cell(index) {
    if (game_state.finished || game_state.paused) { return; }
    game_state.selected_index = index;
    var value = game_state.values[index];
    if (value > 0) { game_state.selected_digit = value; }
    render_all();
  }

  function input_digit(digit) {
    if (game_state.finished || game_state.paused) { return; }
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
    check_win_or_lose();
    persist_game();
  }

  function set_value(index, digit) {
    if (game_state.values[index] === digit) { return; }
    push_undo(index);
    game_state.values[index] = digit;
    game_state.notes[index] = [];
    if (digit !== game_state.solution[index]) {
      game_state.mistakes += 1;
    }
    var num_el = cell_elements[index].querySelector('.cell-num');
    num_el.classList.add('pop-in');
    window.setTimeout(function () { num_el.classList.remove('pop-in'); }, 200);
  }

  function toggle_note(index, digit) {
    if (game_state.values[index] > 0) { return; }
    push_undo(index);
    var notes = game_state.notes[index].slice();
    var pos = notes.indexOf(digit);
    if (pos >= 0) { notes.splice(pos, 1); }
    else {
      notes.push(digit);
      notes.sort(function (a, b) { return a - b; });
    }
    game_state.notes[index] = notes;
  }

  function erase_cell() {
    if (game_state.finished || game_state.paused) { return; }
    var index = game_state.selected_index;
    if (index < 0 || game_state.is_given[index]) { return; }
    if (game_state.values[index] === 0 && game_state.notes[index].length === 0) { return; }
    push_undo(index);
    game_state.values[index] = 0;
    game_state.notes[index] = [];
    render_all();
    persist_game();
  }

  function undo_step() {
    if (game_state.finished || game_state.paused) { return; }
    if (undo_stack.length === 0) {
      show_toast('没有可撤销的操作');
      return;
    }
    var entry = undo_stack.pop();
    game_state.values[entry.index] = entry.prev_value;
    game_state.notes[entry.index] = entry.prev_notes;
    game_state.mistakes = entry.prev_mistakes;
    game_state.selected_index = entry.index;
    render_all();
    persist_game();
  }

  function use_hint() {
    if (game_state.finished || game_state.paused) { return; }
    if (game_state.hints_left <= 0) {
      show_toast('提示次数已用完');
      return;
    }
    var index = game_state.selected_index;
    if (index < 0 || game_state.is_given[index] || game_state.values[index] === game_state.solution[index]) {
      index = -1;
      var i;
      for (i = 0; i < CELLS; i += 1) {
        if (!game_state.is_given[i] && game_state.values[i] !== game_state.solution[i]) {
          index = i;
          break;
        }
      }
    }
    if (index < 0) { return; }
    game_state.hints_left -= 1;
    push_undo(index);
    game_state.values[index] = game_state.solution[index];
    game_state.notes[index] = [];
    game_state.selected_index = index;
    game_state.selected_digit = game_state.solution[index];
    render_all();
    check_win_or_lose();
    persist_game();
  }

  function check_board() {
    if (game_state.finished || game_state.paused) { return; }
    var wrong = 0;
    var empty = 0;
    var i;
    for (i = 0; i < CELLS; i += 1) {
      if (game_state.is_given[i]) { continue; }
      if (game_state.values[i] === 0) { empty += 1; continue; }
      if (game_state.values[i] !== game_state.solution[i]) { wrong += 1; }
    }
    if (wrong > 0) { show_toast('发现 ' + wrong + ' 处错误，已红色标记'); }
    else if (empty > 0) { show_toast('当前填写全部正确，继续加油'); }
    else { show_toast('太棒了，全部正确'); }
    render_all();
  }

  function toggle_pause() {
    if (game_state.finished) { return; }
    game_state.paused = !game_state.paused;
    dom.pause_overlay.hidden = !game_state.paused;
  }

  function check_win_or_lose() {
    if (game_state.finished) { return; }
    if (game_state.mistakes >= SUDOKU_GAME_RULES.max_mistakes) {
      game_state.finished = true;
      stop_timer();
      clear_saved_game();
      dom.lose_modal.hidden = false;
      return;
    }
    var i;
    for (i = 0; i < CELLS; i += 1) {
      if (game_state.values[i] !== game_state.solution[i]) { return; }
    }
    game_state.finished = true;
    stop_timer();
    clear_saved_game();
    dom.win_time.textContent = format_seconds(game_state.elapsed_seconds);
    dom.win_mistakes.textContent = String(game_state.mistakes);
    dom.win_modal.hidden = false;
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
        case 'toggle-pause':
          toggle_pause();
          break;
        case 'back-home':
          back_home();
          break;
        case 'restart-game':
          start_game(game_state.difficulty_key);
          break;
        case 'undo':
          undo_step();
          break;
        case 'erase':
          erase_cell();
          break;
        case 'toggle-note':
          game_state.note_mode = !game_state.note_mode;
          render_all();
          break;
        case 'hint':
          use_hint();
          break;
        case 'check':
          check_board();
          break;
        case 'win-back-home':
        case 'lose-back-home':
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
    resume_saved_game_if_exists();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
