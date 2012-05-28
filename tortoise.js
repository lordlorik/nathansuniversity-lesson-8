tortoise = (function (undefined) {
    /* PUBLIC INTERFACE */

    var eval = function (string, env) {
        return evalTortoise(tortoiseParser.parse(string), env);
    };

    var evalTortoise = function (stmts, env) {
        if (env && !env.bindings) env = { bindings: env };
        if (!env) env = { bindings: {} }
        env.outer = {
            bindings: builtinFunctions
        };

        var tmp = evalFull(evalStatements, stmts, env);

        return isArray(tmp) && tmp[0] === breaker ? tmp[1] : tmp;
    };

    var addBindingConst = function (v, val) {
        if (v in builtinFunctions) throw('Symbol already defined: ' + v);
        return builtinFunctions[v] = '' + val;
    };

    var addBindingVar = function (v, val) {
        if (v in builtinFunctions) throw('Symbol already defined: ' + v);
        return builtinFunctions[v] = val;
    };

    var addBindingFunc = function (v, val, nParams) {
        if (v in builtinFunctions) throw('Symbol already defined: ' + v);
        return builtinFunctions[v] = {
            func: val,
            nArgs: +nParams,
            thunked: false
        };
    };

    // Built-in functions

    var builtinFunctions = { };
    var radToDeg = Math.PI / 180;

    addBindingFunc('alert', typeof alert == 'undefined' ? console.log : alert, 1);

    addBindingConst('PI', Math.PI);
    addBindingConst('E', Math.E);

    addBindingFunc('sin', function (a) { return Math.sin(a * radToDeg); }, 1);
    addBindingFunc('cos', function (a) { return Math.cos(a * radToDeg); }, 1);
    addBindingFunc('tan', function (a) { return Math.tan(a * radToDeg); }, 1);
    addBindingFunc('asin', function (n) { return Math.asin(n) / radToDeg; }, 1);
    addBindingFunc('acos', function (n) { return Math.acos(n) / radToDeg; }, 1);
    addBindingFunc('atan', function (n) { return Math.atan(n) * radToDeg; }, 1);
    addBindingFunc('atan2', function (x, y) { return Math.atan2(x, y) * radToDeg; }, 2);

    addBindingFunc('abs', Math.abs, 1);
    addBindingFunc('ceil', Math.ceil, 1);
    addBindingFunc('floor', Math.floor, 1);
    addBindingFunc('round', Math.round, 1);
    addBindingFunc('log', Math.log, 1);
    addBindingFunc('exp', Math.exp, 1);
    addBindingFunc('sqrt', Math.sqrt, 1);
    addBindingFunc('pow', Math.pow, 2);
    addBindingFunc('min', Math.min, 2);
    addBindingFunc('max', Math.max, 2);

    /* HELPERS */

    var isArray = function (obj) {
        return obj && obj instanceof Array;
    };

    /* CORE */

    var breaker = {};
    var thkVal = {};
    var thkThunk = {};
    var arraySlice = Array.prototype.slice;
    var undefinedBodyThunk = { tag: 'ignore', body: { tag: 'undef' } };

    var lookupBinding = function (env, v) {
        if (!env) throw('Symbol not defined: ' + v);
        if (v in env.bindings) {
            var tmp = env.bindings[v];

            return typeof tmp === 'object' ? tmp : +tmp;
        }
        return lookupBinding(env.outer, v);
    };

    var updateBinding = function (env, v, val) {
        if (!env) throw('Symbol not defined: ' + v);
        if (v in env.bindings) {
            if (typeof env.bindings[v] !== typeof val) throw('Cannot update symbol: ' + v);
            return env.bindings[v] = val;
        }
        return updateBinding(env.outer, v, val);
    };

    var addBinding = function (env, v, val) {
        if (v in env.bindings) throw('Symbol already defined: ' + v);
        return env.bindings[v] = val;
    };

    var thunk = function () {
        var args = arraySlice.call(arguments);
        var f = args.shift();

        return [thkThunk, f, args];
    };

    var thunkValue = function (x) {
        return [thkVal, x];
    };

    var stepStart = function (f, expr, env) {
        return [f.call(null, expr, env, thunkValue, function (x) { throw('Unhandled exception: ' + x); }), false];
    };

    var step = function (state) {
        var thk = state[0];

        if (thk[0] === thkThunk) {
            state[0] = thk[1].apply(null, thk[2]);
        }
        else if (thk[0] === thkVal) {
            state[0] = thk[1];
            state[1] = true;
        }
        else {
            throw('Bad thunk');
        }
    };

    var evalFull = function (f, expr, env) {
        var state = stepStart(f, expr, env);

        while (!state[1]) step(state);
        return state[0];
    };

    var doUnaryOp = function (expr, env, cont, xcont, op) {
        return thunk(evalExpr, expr, env, function (v) {
            var tmp = op(cont, xcont, v);

            return thunk(tmp[0], tmp[1]);
        }, xcont);
    };

    var doBinaryOp = function (exprLeft, exprRight, env, cont, xcont, op) {
        return thunk(evalExpr, exprLeft, env, function (x) {
            return thunk(evalExpr, exprRight, env, function (y) {
                var tmp = op(cont, xcont, x, y);

                return thunk(tmp[0], tmp[1]);
            }, xcont);
        }, xcont);
    };

    var doTernaryOp = function (exprLeft, exprMid, exprRight, env, cont, xcont, op1, op2) {
        return thunk(evalExpr, exprMid, env, function (y) {
            return thunk(evalExpr, exprLeft, env, function (x) {
                var tmp1 = op1(cont, xcont, x, y);

                return tmp1[0] === xcont ? thunk(xcont, tmp1[1]) : !x ? thunk(cont, x) : thunk(evalExpr, exprRight, env, function (z) {
                    var tmp2 = op2(cont, xcont, y, z);

                    return thunk(tmp2[0], tmp2[1]);
                }, xcont);
            }, xcont);
        }, xcont);
    };

    var ops = {
        // Unary operators
        '!' : function (c, e, v) { return [c, v === 0 ? 1 : 0]; },
        'neg': function (c, e, v) { return [c, -v]; },

        // Binary operators
        '+': function (c, e, x, y) { return [c, +x + y]; },
        '-': function (c, e, x, y) { return [c, x - y]; },
        '*': function (c, e, x, y) { return [c, x * y]; },
        '/': function (c, e, x, y) {
            if (y === 0) return [e, 'Division by zero'];
            return [c, x / y];
        },
        '%': function (c, e, x, y) {
            if (y === 0) return [e, 'Division by zero'];
            return [c, x % y];
        },
        '**': function (c, e, x, y) { return [c, y === 0 ? 1 : x && Math.pow(x, y)]; },
        '==': function (c, e, x, y) { return [c, x === y ? 1 : 0]; },
        '!=': function (c, e, x, y) { return [c, x !== y ? 1 : 0]; },
        '<': function (c, e, x, y) { return [c, x < y ? 1 : 0]; },
        '>': function (c, e, x, y) { return [c, x > y ? 1 : 0]; },
        '<=': function (c, e, x, y) { return [c, x <= y ? 1 : 0]; },
        '>=': function (c, e, x, y) { return [c, x >= y ? 1 : 0]; }
    };

    var evalStatements = function (stmts, env, cont, xcont) {
        var len = stmts.length;
        var idx = -1;

        var stmtEvalCont = function (r) {
            if (isArray(r) && r[0] === breaker) return thunk(cont, r);
            return ++idx < len ? thunk(evalStatement, stmts[idx], env, stmtEvalCont, xcont)
                : thunk(cont, r);
        };

        return stmtEvalCont(undefined);
    };

    var evalStatement = function (stmt, env, cont, xcont) {
        switch (stmt.tag) {
            // A single expression
            case 'ignore':
                return thunk(evalExpr, stmt.body, env, cont, xcont);

            // Variable declaration
            case 'var':
                return thunk(evalExpr, stmt.body || 0, env, function (v) {
                    addBinding(env, stmt.name, v);
                    return thunk(cont, v);
                }, xcont)

            // Const declaration
            case 'const':
                return thunk(evalExpr, stmt.body || 0, env, function (v) {
                    v = '' + v;
                    addBinding(env, stmt.name, v);
                    return thunk(cont, v);
                }, xcont)

            // Function declaration
            case 'define':
                addBinding(env, stmt.name, {
                    func: function (cont, xcont) {
                        var newEnv = {
                            outer: env,
                            bindings: { }
                        };
                        var result;
                        var args = stmt.args;

                        for (var i = 0; i < args.length; ++i) newEnv.bindings[args[i]] = arguments[i + 2];
                        return thunk(evalStatements, stmt.body, newEnv, function (r) {
                            return thunk(cont, isArray(r) && r[0] === breaker ? r[1] : r);
                        }, xcont);
                    },
                    nArgs: stmt.args.length,
                    thunked: true
                });
                return thunk(cont, undefined);

            // Assignment
            case ':=':
                return thunk(evalExpr, stmt.right, env, function (v) {
                    updateBinding(env, stmt.left, v);
                    return thunk(cont, v);
                }, xcont)

            // If/Else
            case 'if':
                return thunk(evalExpr, stmt.expr, env, function (c) {
                    return thunk(evalStatements, c && stmt.body || stmt.body2 || undefinedBodyThunk, env, cont, xcont);
                }, xcont);

            // Repeat
            case 'repeat':
                return thunk(evalExpr, stmt.expr, env, function (n) {
                    if (n > 0) {
                        var loopCont = function (r) {
                            return n-- > 0 ? thunk(evalStatements, stmt.body, env, loopCont, xcont) : thunk(cont, r);
                        };

                        return loopCont(undefined);
                    }
                    else {
                        return thunk(cont, undefined);
                    }
                });

            // While
            case 'while':
                var ret = undefined;
                var whileCont = function () {
                    return thunk(evalExpr, stmt.expr, env, function (c) {
                        return c ? thunk(evalStatements, stmt.body, env, function (r) {
                            ret = r;
                            return whileCont();
                        }, xcont) : thunk(cont, ret);
                    }, xcont);
                };

                return whileCont();

            // Return
            case 'return':
                return thunk(evalExpr, stmt.expr, env, function (v) {
                    return thunk(cont, [breaker, v]);
                }, xcont);

            // Return
            case 'try':
                return thunk(evalStatements, stmt.body, env, cont, function (ex) {
                    return thunk(evalStatements, stmt.body2, env, cont, xcont);
                });
        }
    };

    var evalExpr = function (expr, env, cont, xcont) {
        // Numbers evaluate to themselves
        if (typeof expr === 'number') return thunk(cont, expr);

        var tmp, tag;

        switch (tag = expr.tag) {
            // Special

            case 'undef':
                return thunk(cont, undefined);

            case 'throw':
                return thunk(xcont, 'User exception');

            case 'ident':
                tmp = lookupBinding(env, expr.name);
                if (typeof tmp === 'object') throw('Variable expected: ' + expr.name);
                return thunk(cont, +tmp);

            case 'call':
                var tmp2 = [];
                var len = expr.args.length;
                var idx = -1;

                tmp = lookupBinding(env, expr.name);
                if (typeof tmp !== 'object') throw('Function expected: ' + expr.name);
                if (len !== tmp.nArgs) throw('Function \'' + expr.name + '\' needs exactly ' + tmp.nArgs + ' arguments');

                var funcEvalCont = function (r) {
                    if (idx >= 0) tmp2[idx] = r;
                    ++idx;
                    return idx < len ? thunk(evalExpr, expr.args[idx], env, funcEvalCont, xcont)
                        : tmp.thunked ? (tmp2.unshift(xcont), tmp2.unshift(cont), tmp.func.apply(null, tmp2))
                        : thunk(cont, tmp.func.apply(null, tmp2));
                };

                return funcEvalCont(undefined);

            // Unary operators

            case '!':
            case 'neg':
                return doUnaryOp(expr.arg, env, cont, xcont, ops[tag]);

            // Binary operators

            case '+':
            case '-':
            case '*':
            case '/':
            case '%':
            case '**':
            case '==':
            case '!=':
            case '<':
            case '>':
            case '<=':
            case '>=':
                return doBinaryOp(expr.left, expr.right, env, cont, xcont, ops[tag]);

            case '&&':
                return thunk(evalExpr, expr.left, env, function (x) {
                    return !x ? thunk(cont, x) : thunk(evalExpr, expr.right, env, function (y) {
                        return thunk(cont, y);
                    }, xcont);
                }, xcont);

            case '||':
                return thunk(evalExpr, expr.left, env, function (x) {
                    return x ? thunk(cont, x) : thunk(evalExpr, expr.right, env, function (y) {
                        return thunk(cont, y);
                    }, xcont);
                }, xcont);

            // Ternary operators

            case '? :':
                return thunk(evalExpr, expr.left, env, function (x) {
                    return x ? thunk(evalExpr, expr.middle, env, function (y) {
                        return thunk(cont, y);
                    }, xcont) : thunk(evalExpr, expr.right, env, function (z) {
                        return thunk(cont, z);
                    }, xcont);
                }, xcont);

            case '< <':
            case '< <=':
            case '<= <':
            case '<= <=':
            case '> >':
            case '> >=':
            case '>= >':
            case '>= >=':
                tmp = tag.split(' ');
                return doTernaryOp(expr.left, expr.middle, expr.right, env, cont, xcont, ops[tmp[0]], ops[tmp[1]]);

            default:
                throw('Unknown operator: \'' + tag + '\'');
        }
    };

    return {
        eval: eval,
        evalTortoise: evalTortoise,
        addBindingConst: addBindingConst,
        addBindingVar: addBindingVar,
        addBindingFunc: addBindingFunc
    };
})();