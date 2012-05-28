CodeMirror.defineMode('tortoise', function(config, parserConfig) {
  function words(str) {
    var obj = {}, words = str.split(' ');
    for (var i = 0; i < words.length; ++i) obj[words[i]] = true;
    return obj;
  };

  var indentUnit = config.indentUnit,
      keywords = words('define var const if else while repeat return try catch throw'),
      blockKeywords = words('define if while try'),
      atoms = {},
      hooks = {},
      multiLineStrings = parserConfig.multiLineStrings,
      isOperatorChar = /[+\-*&%=<>!?:|\/]/;

  var curPunc;

  function tokenBase(stream, state) {
    var ch = stream.next();
    if (hooks[ch]) {
      var result = hooks[ch](stream, state);
      if (result !== false) return result;
    }
    if (ch == '"' || ch == "'") {
      state.tokenize = tokenString(ch);
      return state.tokenize(stream, state);
    }
    if (/[\[\]{}\(\),;\.]/.test(ch)) {
      curPunc = ch;
      return null;
    }
    if (/\d/.test(ch)) {
      stream.eatWhile(/[\w\.]/);
      return 'number';
    }
    if (ch == '#') {
      stream.eatWhile(/[a-fA-F0-9]/);
      return 'number';
    }
    if (ch == '/') {
      if (stream.eat('/')) {
        stream.skipToEnd();
        return 'comment';
      }
    }
    if (isOperatorChar.test(ch)) {
      stream.eatWhile(isOperatorChar);
      return 'operator';
    }
    stream.eatWhile(/[\w\$_]/);
    var cur = stream.current();
    if (keywords.propertyIsEnumerable(cur)) {
      if (blockKeywords.propertyIsEnumerable(cur)) curPunc = 'newstatement';
      return 'keyword';
    }
    if (atoms.propertyIsEnumerable(cur)) return 'atom';
    return 'word';
  }

  function tokenString(quote) {
    return function(stream, state) {
      var escaped = false, next, end = false;
      while ((next = stream.next()) != null) {
        if (next == quote && !escaped) {end = true; break;}
        escaped = !escaped && next == '\\';
      }
      if (end || !(escaped || multiLineStrings))
        state.tokenize = null;
      return 'string';
    };
  }

  function Context(indented, column, type, align, prev) {
    this.indented = indented;
    this.column = column;
    this.type = type;
    this.align = align;
    this.prev = prev;
  }
  function pushContext(state, col, type) {
    return state.context = new Context(state.indented, col, type, null, state.context);
  }
  function popContext(state) {
    var t = state.context.type;
    if (t == ')' || t == ']' || t == '}')
      state.indented = state.context.indented;
    return state.context = state.context.prev;
  }

  // Interface

  return {
    startState: function(basecolumn) {
      return {
        tokenize: null,
        context: new Context((basecolumn || 0) - indentUnit, 0, 'top', false),
        indented: 0,
        startOfLine: true
      };
    },

    token: function(stream, state) {
      var ctx = state.context;
      if (stream.sol()) {
        if (ctx.align == null) ctx.align = false;
        state.indented = stream.indentation();
        state.startOfLine = true;
      }
      if (stream.eatSpace()) return null;
      curPunc = null;
      var style = (state.tokenize || tokenBase)(stream, state);
      if (style == 'comment' || style == 'meta') return style;
      if (ctx.align == null) ctx.align = true;

      if ((curPunc == ';' || curPunc == ':') && ctx.type == 'statement') popContext(state);
      else if (curPunc == '{') pushContext(state, stream.column(), '}');
      else if (curPunc == '[') pushContext(state, stream.column(), ']');
      else if (curPunc == '(') pushContext(state, stream.column(), ')');
      else if (curPunc == '}') {
        while (ctx.type == 'statement') ctx = popContext(state);
        if (ctx.type == '}') ctx = popContext(state);
        while (ctx.type == 'statement') ctx = popContext(state);
      }
      else if (curPunc == ctx.type) popContext(state);
      else if (ctx.type == '}' || ctx.type == 'top' || (ctx.type == 'statement' && curPunc == 'newstatement'))
        pushContext(state, stream.column(), 'statement');
      state.startOfLine = false;
      return style;
    },

    indent: function(state, textAfter) {
      if (state.tokenize != tokenBase && state.tokenize != null) return 0;
      var ctx = state.context, firstChar = textAfter && textAfter.charAt(0);
      if (ctx.type == 'statement' && firstChar == '}') ctx = ctx.prev;
      var closing = firstChar == ctx.type;
      if (ctx.type == 'statement') return ctx.indented + (firstChar == '{' ? 0 : indentUnit);
      else if (ctx.align) return ctx.column + (closing ? 0 : 1);
      else return ctx.indented + (closing ? 0 : indentUnit);
    },

    electricChars: '{}'
  };
});

CodeMirror.defineMIME('text/tortoise', 'tortoise');
