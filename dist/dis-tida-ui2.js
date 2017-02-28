(function () {
/**
 * @license almond 0.3.3 Copyright jQuery Foundation and other contributors.
 * Released under MIT license, http://github.com/requirejs/almond/LICENSE
 */
//Going sloppy to avoid 'use strict' string cost, but strict practices should
//be followed.
/*global setTimeout: false */

var requirejs, require, define;
(function (undef) {
    var main, req, makeMap, handlers,
        defined = {},
        waiting = {},
        config = {},
        defining = {},
        hasOwn = Object.prototype.hasOwnProperty,
        aps = [].slice,
        jsSuffixRegExp = /\.js$/;

    function hasProp(obj, prop) {
        return hasOwn.call(obj, prop);
    }

    /**
     * Given a relative module name, like ./something, normalize it to
     * a real name that can be mapped to a path.
     * @param {String} name the relative name
     * @param {String} baseName a real name that the name arg is relative
     * to.
     * @returns {String} normalized name
     */
    function normalize(name, baseName) {
        var nameParts, nameSegment, mapValue, foundMap, lastIndex,
            foundI, foundStarMap, starI, i, j, part, normalizedBaseParts,
            baseParts = baseName && baseName.split("/"),
            map = config.map,
            starMap = (map && map['*']) || {};

        //Adjust any relative paths.
        if (name) {
            name = name.split('/');
            lastIndex = name.length - 1;

            // If wanting node ID compatibility, strip .js from end
            // of IDs. Have to do this here, and not in nameToUrl
            // because node allows either .js or non .js to map
            // to same file.
            if (config.nodeIdCompat && jsSuffixRegExp.test(name[lastIndex])) {
                name[lastIndex] = name[lastIndex].replace(jsSuffixRegExp, '');
            }

            // Starts with a '.' so need the baseName
            if (name[0].charAt(0) === '.' && baseParts) {
                //Convert baseName to array, and lop off the last part,
                //so that . matches that 'directory' and not name of the baseName's
                //module. For instance, baseName of 'one/two/three', maps to
                //'one/two/three.js', but we want the directory, 'one/two' for
                //this normalization.
                normalizedBaseParts = baseParts.slice(0, baseParts.length - 1);
                name = normalizedBaseParts.concat(name);
            }

            //start trimDots
            for (i = 0; i < name.length; i++) {
                part = name[i];
                if (part === '.') {
                    name.splice(i, 1);
                    i -= 1;
                } else if (part === '..') {
                    // If at the start, or previous value is still ..,
                    // keep them so that when converted to a path it may
                    // still work when converted to a path, even though
                    // as an ID it is less than ideal. In larger point
                    // releases, may be better to just kick out an error.
                    if (i === 0 || (i === 1 && name[2] === '..') || name[i - 1] === '..') {
                        continue;
                    } else if (i > 0) {
                        name.splice(i - 1, 2);
                        i -= 2;
                    }
                }
            }
            //end trimDots

            name = name.join('/');
        }

        //Apply map config if available.
        if ((baseParts || starMap) && map) {
            nameParts = name.split('/');

            for (i = nameParts.length; i > 0; i -= 1) {
                nameSegment = nameParts.slice(0, i).join("/");

                if (baseParts) {
                    //Find the longest baseName segment match in the config.
                    //So, do joins on the biggest to smallest lengths of baseParts.
                    for (j = baseParts.length; j > 0; j -= 1) {
                        mapValue = map[baseParts.slice(0, j).join('/')];

                        //baseName segment has  config, find if it has one for
                        //this name.
                        if (mapValue) {
                            mapValue = mapValue[nameSegment];
                            if (mapValue) {
                                //Match, update name to the new value.
                                foundMap = mapValue;
                                foundI = i;
                                break;
                            }
                        }
                    }
                }

                if (foundMap) {
                    break;
                }

                //Check for a star map match, but just hold on to it,
                //if there is a shorter segment match later in a matching
                //config, then favor over this star map.
                if (!foundStarMap && starMap && starMap[nameSegment]) {
                    foundStarMap = starMap[nameSegment];
                    starI = i;
                }
            }

            if (!foundMap && foundStarMap) {
                foundMap = foundStarMap;
                foundI = starI;
            }

            if (foundMap) {
                nameParts.splice(0, foundI, foundMap);
                name = nameParts.join('/');
            }
        }

        return name;
    }

    function makeRequire(relName, forceSync) {
        return function () {
            //A version of a require function that passes a moduleName
            //value for items that may need to
            //look up paths relative to the moduleName
            var args = aps.call(arguments, 0);

            //If first arg is not require('string'), and there is only
            //one arg, it is the array form without a callback. Insert
            //a null so that the following concat is correct.
            if (typeof args[0] !== 'string' && args.length === 1) {
                args.push(null);
            }
            return req.apply(undef, args.concat([relName, forceSync]));
        };
    }

    function makeNormalize(relName) {
        return function (name) {
            return normalize(name, relName);
        };
    }

    function makeLoad(depName) {
        return function (value) {
            defined[depName] = value;
        };
    }

    function callDep(name) {
        if (hasProp(waiting, name)) {
            var args = waiting[name];
            delete waiting[name];
            defining[name] = true;
            main.apply(undef, args);
        }

        if (!hasProp(defined, name) && !hasProp(defining, name)) {
            throw new Error('No ' + name);
        }
        return defined[name];
    }

    //Turns a plugin!resource to [plugin, resource]
    //with the plugin being undefined if the name
    //did not have a plugin prefix.
    function splitPrefix(name) {
        var prefix,
            index = name ? name.indexOf('!') : -1;
        if (index > -1) {
            prefix = name.substring(0, index);
            name = name.substring(index + 1, name.length);
        }
        return [prefix, name];
    }

    //Creates a parts array for a relName where first part is plugin ID,
    //second part is resource ID. Assumes relName has already been normalized.
    function makeRelParts(relName) {
        return relName ? splitPrefix(relName) : [];
    }

    /**
     * Makes a name map, normalizing the name, and using a plugin
     * for normalization if necessary. Grabs a ref to plugin
     * too, as an optimization.
     */
    makeMap = function (name, relParts) {
        var plugin,
            parts = splitPrefix(name),
            prefix = parts[0],
            relResourceName = relParts[1];

        name = parts[1];

        if (prefix) {
            prefix = normalize(prefix, relResourceName);
            plugin = callDep(prefix);
        }

        //Normalize according
        if (prefix) {
            if (plugin && plugin.normalize) {
                name = plugin.normalize(name, makeNormalize(relResourceName));
            } else {
                name = normalize(name, relResourceName);
            }
        } else {
            name = normalize(name, relResourceName);
            parts = splitPrefix(name);
            prefix = parts[0];
            name = parts[1];
            if (prefix) {
                plugin = callDep(prefix);
            }
        }

        //Using ridiculous property names for space reasons
        return {
            f: prefix ? prefix + '!' + name : name, //fullName
            n: name,
            pr: prefix,
            p: plugin
        };
    };

    function makeConfig(name) {
        return function () {
            return (config && config.config && config.config[name]) || {};
        };
    }

    handlers = {
        require: function (name) {
            return makeRequire(name);
        },
        exports: function (name) {
            var e = defined[name];
            if (typeof e !== 'undefined') {
                return e;
            } else {
                return (defined[name] = {});
            }
        },
        module: function (name) {
            return {
                id: name,
                uri: '',
                exports: defined[name],
                config: makeConfig(name)
            };
        }
    };

    main = function (name, deps, callback, relName) {
        var cjsModule, depName, ret, map, i, relParts,
            args = [],
            callbackType = typeof callback,
            usingExports;

        //Use name if no relName
        relName = relName || name;
        relParts = makeRelParts(relName);

        //Call the callback to define the module, if necessary.
        if (callbackType === 'undefined' || callbackType === 'function') {
            //Pull out the defined dependencies and pass the ordered
            //values to the callback.
            //Default to [require, exports, module] if no deps
            deps = !deps.length && callback.length ? ['require', 'exports', 'module'] : deps;
            for (i = 0; i < deps.length; i += 1) {
                map = makeMap(deps[i], relParts);
                depName = map.f;

                //Fast path CommonJS standard dependencies.
                if (depName === "require") {
                    args[i] = handlers.require(name);
                } else if (depName === "exports") {
                    //CommonJS module spec 1.1
                    args[i] = handlers.exports(name);
                    usingExports = true;
                } else if (depName === "module") {
                    //CommonJS module spec 1.1
                    cjsModule = args[i] = handlers.module(name);
                } else if (hasProp(defined, depName) ||
                           hasProp(waiting, depName) ||
                           hasProp(defining, depName)) {
                    args[i] = callDep(depName);
                } else if (map.p) {
                    map.p.load(map.n, makeRequire(relName, true), makeLoad(depName), {});
                    args[i] = defined[depName];
                } else {
                    throw new Error(name + ' missing ' + depName);
                }
            }

            ret = callback ? callback.apply(defined[name], args) : undefined;

            if (name) {
                //If setting exports via "module" is in play,
                //favor that over return value and exports. After that,
                //favor a non-undefined return value over exports use.
                if (cjsModule && cjsModule.exports !== undef &&
                        cjsModule.exports !== defined[name]) {
                    defined[name] = cjsModule.exports;
                } else if (ret !== undef || !usingExports) {
                    //Use the return value from the function.
                    defined[name] = ret;
                }
            }
        } else if (name) {
            //May just be an object definition for the module. Only
            //worry about defining if have a module name.
            defined[name] = callback;
        }
    };

    requirejs = require = req = function (deps, callback, relName, forceSync, alt) {
        if (typeof deps === "string") {
            if (handlers[deps]) {
                //callback in this case is really relName
                return handlers[deps](callback);
            }
            //Just return the module wanted. In this scenario, the
            //deps arg is the module name, and second arg (if passed)
            //is just the relName.
            //Normalize module name, if it contains . or ..
            return callDep(makeMap(deps, makeRelParts(callback)).f);
        } else if (!deps.splice) {
            //deps is a config object, not an array.
            config = deps;
            if (config.deps) {
                req(config.deps, config.callback);
            }
            if (!callback) {
                return;
            }

            if (callback.splice) {
                //callback is an array, which means it is a dependency list.
                //Adjust args if there are dependencies
                deps = callback;
                callback = relName;
                relName = null;
            } else {
                deps = undef;
            }
        }

        //Support require(['a'])
        callback = callback || function () {};

        //If relName is a function, it is an errback handler,
        //so remove it.
        if (typeof relName === 'function') {
            relName = forceSync;
            forceSync = alt;
        }

        //Simulate async callback;
        if (forceSync) {
            main(undef, deps, callback, relName);
        } else {
            //Using a non-zero value because of concern for what old browsers
            //do, and latest browsers "upgrade" to 4 if lower value is used:
            //http://www.whatwg.org/specs/web-apps/current-work/multipage/timers.html#dom-windowtimers-settimeout:
            //If want a value immediately, use require('id') instead -- something
            //that works in almond on the global level, but not guaranteed and
            //unlikely to work in other AMD implementations.
            setTimeout(function () {
                main(undef, deps, callback, relName);
            }, 4);
        }

        return req;
    };

    /**
     * Just drops the config on the floor, but returns req in case
     * the config return value is used.
     */
    req.config = function (cfg) {
        return req(cfg);
    };

    /**
     * Expose module registry for debugging and tooling
     */
    requirejs._defined = defined;

    define = function (name, deps, callback) {
        if (typeof name !== 'string') {
            throw new Error('See almond README: incorrect module build, no module name');
        }

        //This module may not have dependencies
        if (!deps.splice) {
            //deps is not an array, so probably means
            //an object literal or factory function for
            //the value. Adjust args.
            callback = deps;
            deps = [];
        }

        if (!hasProp(defined, name) && !hasProp(waiting, name)) {
            waiting[name] = [name, deps, callback];
        }
    };

    define.amd = {
        jQuery: true
    };
}());

define("almond", function(){});

/*!
 * jQuery JavaScript Library v1.11.3
 * http://jquery.com/
 *
 * Includes Sizzle.js
 * http://sizzlejs.com/
 *
 * Copyright 2005, 2014 jQuery Foundation, Inc. and other contributors
 * Released under the MIT license
 * http://jquery.org/license
 *
 * Date: 2015-04-28T16:19Z
 */

(function( global, factory ) {

	if ( typeof module === "object" && typeof module.exports === "object" ) {
		// For CommonJS and CommonJS-like environments where a proper window is present,
		// execute the factory and get jQuery
		// For environments that do not inherently posses a window with a document
		// (such as Node.js), expose a jQuery-making factory as module.exports
		// This accentuates the need for the creation of a real window
		// e.g. var jQuery = require("jquery")(window);
		// See ticket #14549 for more info
		module.exports = global.document ?
			factory( global, true ) :
			function( w ) {
				if ( !w.document ) {
					throw new Error( "jQuery requires a window with a document" );
				}
				return factory( w );
			};
	} else {
		factory( global );
	}

// Pass this if window is not defined yet
}(typeof window !== "undefined" ? window : this, function( window, noGlobal ) {

// Can't do this because several apps including ASP.NET trace
// the stack via arguments.caller.callee and Firefox dies if
// you try to trace through "use strict" call chains. (#13335)
// Support: Firefox 18+
//

var deletedIds = [];

var slice = deletedIds.slice;

var concat = deletedIds.concat;

var push = deletedIds.push;

var indexOf = deletedIds.indexOf;

var class2type = {};

var toString = class2type.toString;

var hasOwn = class2type.hasOwnProperty;

var support = {};



var
	version = "1.11.3",

	// Define a local copy of jQuery
	jQuery = function( selector, context ) {
		// The jQuery object is actually just the init constructor 'enhanced'
		// Need init if jQuery is called (just allow error to be thrown if not included)
		return new jQuery.fn.init( selector, context );
	},

	// Support: Android<4.1, IE<9
	// Make sure we trim BOM and NBSP
	rtrim = /^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g,

	// Matches dashed string for camelizing
	rmsPrefix = /^-ms-/,
	rdashAlpha = /-([\da-z])/gi,

	// Used by jQuery.camelCase as callback to replace()
	fcamelCase = function( all, letter ) {
		return letter.toUpperCase();
	};

jQuery.fn = jQuery.prototype = {
	// The current version of jQuery being used
	jquery: version,

	constructor: jQuery,

	// Start with an empty selector
	selector: "",

	// The default length of a jQuery object is 0
	length: 0,

	toArray: function() {
		return slice.call( this );
	},

	// Get the Nth element in the matched element set OR
	// Get the whole matched element set as a clean array
	get: function( num ) {
		return num != null ?

			// Return just the one element from the set
			( num < 0 ? this[ num + this.length ] : this[ num ] ) :

			// Return all the elements in a clean array
			slice.call( this );
	},

	// Take an array of elements and push it onto the stack
	// (returning the new matched element set)
	pushStack: function( elems ) {

		// Build a new jQuery matched element set
		var ret = jQuery.merge( this.constructor(), elems );

		// Add the old object onto the stack (as a reference)
		ret.prevObject = this;
		ret.context = this.context;

		// Return the newly-formed element set
		return ret;
	},

	// Execute a callback for every element in the matched set.
	// (You can seed the arguments with an array of args, but this is
	// only used internally.)
	each: function( callback, args ) {
		return jQuery.each( this, callback, args );
	},

	map: function( callback ) {
		return this.pushStack( jQuery.map(this, function( elem, i ) {
			return callback.call( elem, i, elem );
		}));
	},

	slice: function() {
		return this.pushStack( slice.apply( this, arguments ) );
	},

	first: function() {
		return this.eq( 0 );
	},

	last: function() {
		return this.eq( -1 );
	},

	eq: function( i ) {
		var len = this.length,
			j = +i + ( i < 0 ? len : 0 );
		return this.pushStack( j >= 0 && j < len ? [ this[j] ] : [] );
	},

	end: function() {
		return this.prevObject || this.constructor(null);
	},

	// For internal use only.
	// Behaves like an Array's method, not like a jQuery method.
	push: push,
	sort: deletedIds.sort,
	splice: deletedIds.splice
};

jQuery.extend = jQuery.fn.extend = function() {
	var src, copyIsArray, copy, name, options, clone,
		target = arguments[0] || {},
		i = 1,
		length = arguments.length,
		deep = false;

	// Handle a deep copy situation
	if ( typeof target === "boolean" ) {
		deep = target;

		// skip the boolean and the target
		target = arguments[ i ] || {};
		i++;
	}

	// Handle case when target is a string or something (possible in deep copy)
	if ( typeof target !== "object" && !jQuery.isFunction(target) ) {
		target = {};
	}

	// extend jQuery itself if only one argument is passed
	if ( i === length ) {
		target = this;
		i--;
	}

	for ( ; i < length; i++ ) {
		// Only deal with non-null/undefined values
		if ( (options = arguments[ i ]) != null ) {
			// Extend the base object
			for ( name in options ) {
				src = target[ name ];
				copy = options[ name ];

				// Prevent never-ending loop
				if ( target === copy ) {
					continue;
				}

				// Recurse if we're merging plain objects or arrays
				if ( deep && copy && ( jQuery.isPlainObject(copy) || (copyIsArray = jQuery.isArray(copy)) ) ) {
					if ( copyIsArray ) {
						copyIsArray = false;
						clone = src && jQuery.isArray(src) ? src : [];

					} else {
						clone = src && jQuery.isPlainObject(src) ? src : {};
					}

					// Never move original objects, clone them
					target[ name ] = jQuery.extend( deep, clone, copy );

				// Don't bring in undefined values
				} else if ( copy !== undefined ) {
					target[ name ] = copy;
				}
			}
		}
	}

	// Return the modified object
	return target;
};

jQuery.extend({
	// Unique for each copy of jQuery on the page
	expando: "jQuery" + ( version + Math.random() ).replace( /\D/g, "" ),

	// Assume jQuery is ready without the ready module
	isReady: true,

	error: function( msg ) {
		throw new Error( msg );
	},

	noop: function() {},

	// See test/unit/core.js for details concerning isFunction.
	// Since version 1.3, DOM methods and functions like alert
	// aren't supported. They return false on IE (#2968).
	isFunction: function( obj ) {
		return jQuery.type(obj) === "function";
	},

	isArray: Array.isArray || function( obj ) {
		return jQuery.type(obj) === "array";
	},

	isWindow: function( obj ) {
		/* jshint eqeqeq: false */
		return obj != null && obj == obj.window;
	},

	isNumeric: function( obj ) {
		// parseFloat NaNs numeric-cast false positives (null|true|false|"")
		// ...but misinterprets leading-number strings, particularly hex literals ("0x...")
		// subtraction forces infinities to NaN
		// adding 1 corrects loss of precision from parseFloat (#15100)
		return !jQuery.isArray( obj ) && (obj - parseFloat( obj ) + 1) >= 0;
	},

	isEmptyObject: function( obj ) {
		var name;
		for ( name in obj ) {
			return false;
		}
		return true;
	},

	isPlainObject: function( obj ) {
		var key;

		// Must be an Object.
		// Because of IE, we also have to check the presence of the constructor property.
		// Make sure that DOM nodes and window objects don't pass through, as well
		if ( !obj || jQuery.type(obj) !== "object" || obj.nodeType || jQuery.isWindow( obj ) ) {
			return false;
		}

		try {
			// Not own constructor property must be Object
			if ( obj.constructor &&
				!hasOwn.call(obj, "constructor") &&
				!hasOwn.call(obj.constructor.prototype, "isPrototypeOf") ) {
				return false;
			}
		} catch ( e ) {
			// IE8,9 Will throw exceptions on certain host objects #9897
			return false;
		}

		// Support: IE<9
		// Handle iteration over inherited properties before own properties.
		if ( support.ownLast ) {
			for ( key in obj ) {
				return hasOwn.call( obj, key );
			}
		}

		// Own properties are enumerated firstly, so to speed up,
		// if last one is own, then all properties are own.
		for ( key in obj ) {}

		return key === undefined || hasOwn.call( obj, key );
	},

	type: function( obj ) {
		if ( obj == null ) {
			return obj + "";
		}
		return typeof obj === "object" || typeof obj === "function" ?
			class2type[ toString.call(obj) ] || "object" :
			typeof obj;
	},

	// Evaluates a script in a global context
	// Workarounds based on findings by Jim Driscoll
	// http://weblogs.java.net/blog/driscoll/archive/2009/09/08/eval-javascript-global-context
	globalEval: function( data ) {
		if ( data && jQuery.trim( data ) ) {
			// We use execScript on Internet Explorer
			// We use an anonymous function so that context is window
			// rather than jQuery in Firefox
			( window.execScript || function( data ) {
				window[ "eval" ].call( window, data );
			} )( data );
		}
	},

	// Convert dashed to camelCase; used by the css and data modules
	// Microsoft forgot to hump their vendor prefix (#9572)
	camelCase: function( string ) {
		return string.replace( rmsPrefix, "ms-" ).replace( rdashAlpha, fcamelCase );
	},

	nodeName: function( elem, name ) {
		return elem.nodeName && elem.nodeName.toLowerCase() === name.toLowerCase();
	},

	// args is for internal usage only
	each: function( obj, callback, args ) {
		var value,
			i = 0,
			length = obj.length,
			isArray = isArraylike( obj );

		if ( args ) {
			if ( isArray ) {
				for ( ; i < length; i++ ) {
					value = callback.apply( obj[ i ], args );

					if ( value === false ) {
						break;
					}
				}
			} else {
				for ( i in obj ) {
					value = callback.apply( obj[ i ], args );

					if ( value === false ) {
						break;
					}
				}
			}

		// A special, fast, case for the most common use of each
		} else {
			if ( isArray ) {
				for ( ; i < length; i++ ) {
					value = callback.call( obj[ i ], i, obj[ i ] );

					if ( value === false ) {
						break;
					}
				}
			} else {
				for ( i in obj ) {
					value = callback.call( obj[ i ], i, obj[ i ] );

					if ( value === false ) {
						break;
					}
				}
			}
		}

		return obj;
	},

	// Support: Android<4.1, IE<9
	trim: function( text ) {
		return text == null ?
			"" :
			( text + "" ).replace( rtrim, "" );
	},

	// results is for internal usage only
	makeArray: function( arr, results ) {
		var ret = results || [];

		if ( arr != null ) {
			if ( isArraylike( Object(arr) ) ) {
				jQuery.merge( ret,
					typeof arr === "string" ?
					[ arr ] : arr
				);
			} else {
				push.call( ret, arr );
			}
		}

		return ret;
	},

	inArray: function( elem, arr, i ) {
		var len;

		if ( arr ) {
			if ( indexOf ) {
				return indexOf.call( arr, elem, i );
			}

			len = arr.length;
			i = i ? i < 0 ? Math.max( 0, len + i ) : i : 0;

			for ( ; i < len; i++ ) {
				// Skip accessing in sparse arrays
				if ( i in arr && arr[ i ] === elem ) {
					return i;
				}
			}
		}

		return -1;
	},

	merge: function( first, second ) {
		var len = +second.length,
			j = 0,
			i = first.length;

		while ( j < len ) {
			first[ i++ ] = second[ j++ ];
		}

		// Support: IE<9
		// Workaround casting of .length to NaN on otherwise arraylike objects (e.g., NodeLists)
		if ( len !== len ) {
			while ( second[j] !== undefined ) {
				first[ i++ ] = second[ j++ ];
			}
		}

		first.length = i;

		return first;
	},

	grep: function( elems, callback, invert ) {
		var callbackInverse,
			matches = [],
			i = 0,
			length = elems.length,
			callbackExpect = !invert;

		// Go through the array, only saving the items
		// that pass the validator function
		for ( ; i < length; i++ ) {
			callbackInverse = !callback( elems[ i ], i );
			if ( callbackInverse !== callbackExpect ) {
				matches.push( elems[ i ] );
			}
		}

		return matches;
	},

	// arg is for internal usage only
	map: function( elems, callback, arg ) {
		var value,
			i = 0,
			length = elems.length,
			isArray = isArraylike( elems ),
			ret = [];

		// Go through the array, translating each of the items to their new values
		if ( isArray ) {
			for ( ; i < length; i++ ) {
				value = callback( elems[ i ], i, arg );

				if ( value != null ) {
					ret.push( value );
				}
			}

		// Go through every key on the object,
		} else {
			for ( i in elems ) {
				value = callback( elems[ i ], i, arg );

				if ( value != null ) {
					ret.push( value );
				}
			}
		}

		// Flatten any nested arrays
		return concat.apply( [], ret );
	},

	// A global GUID counter for objects
	guid: 1,

	// Bind a function to a context, optionally partially applying any
	// arguments.
	proxy: function( fn, context ) {
		var args, proxy, tmp;

		if ( typeof context === "string" ) {
			tmp = fn[ context ];
			context = fn;
			fn = tmp;
		}

		// Quick check to determine if target is callable, in the spec
		// this throws a TypeError, but we will just return undefined.
		if ( !jQuery.isFunction( fn ) ) {
			return undefined;
		}

		// Simulated bind
		args = slice.call( arguments, 2 );
		proxy = function() {
			return fn.apply( context || this, args.concat( slice.call( arguments ) ) );
		};

		// Set the guid of unique handler to the same of original handler, so it can be removed
		proxy.guid = fn.guid = fn.guid || jQuery.guid++;

		return proxy;
	},

	now: function() {
		return +( new Date() );
	},

	// jQuery.support is not used in Core but other projects attach their
	// properties to it so it needs to exist.
	support: support
});

// Populate the class2type map
jQuery.each("Boolean Number String Function Array Date RegExp Object Error".split(" "), function(i, name) {
	class2type[ "[object " + name + "]" ] = name.toLowerCase();
});

function isArraylike( obj ) {

	// Support: iOS 8.2 (not reproducible in simulator)
	// `in` check used to prevent JIT error (gh-2145)
	// hasOwn isn't used here due to false negatives
	// regarding Nodelist length in IE
	var length = "length" in obj && obj.length,
		type = jQuery.type( obj );

	if ( type === "function" || jQuery.isWindow( obj ) ) {
		return false;
	}

	if ( obj.nodeType === 1 && length ) {
		return true;
	}

	return type === "array" || length === 0 ||
		typeof length === "number" && length > 0 && ( length - 1 ) in obj;
}
var Sizzle =
/*!
 * Sizzle CSS Selector Engine v2.2.0-pre
 * http://sizzlejs.com/
 *
 * Copyright 2008, 2014 jQuery Foundation, Inc. and other contributors
 * Released under the MIT license
 * http://jquery.org/license
 *
 * Date: 2014-12-16
 */
(function( window ) {

var i,
	support,
	Expr,
	getText,
	isXML,
	tokenize,
	compile,
	select,
	outermostContext,
	sortInput,
	hasDuplicate,

	// Local document vars
	setDocument,
	document,
	docElem,
	documentIsHTML,
	rbuggyQSA,
	rbuggyMatches,
	matches,
	contains,

	// Instance-specific data
	expando = "sizzle" + 1 * new Date(),
	preferredDoc = window.document,
	dirruns = 0,
	done = 0,
	classCache = createCache(),
	tokenCache = createCache(),
	compilerCache = createCache(),
	sortOrder = function( a, b ) {
		if ( a === b ) {
			hasDuplicate = true;
		}
		return 0;
	},

	// General-purpose constants
	MAX_NEGATIVE = 1 << 31,

	// Instance methods
	hasOwn = ({}).hasOwnProperty,
	arr = [],
	pop = arr.pop,
	push_native = arr.push,
	push = arr.push,
	slice = arr.slice,
	// Use a stripped-down indexOf as it's faster than native
	// http://jsperf.com/thor-indexof-vs-for/5
	indexOf = function( list, elem ) {
		var i = 0,
			len = list.length;
		for ( ; i < len; i++ ) {
			if ( list[i] === elem ) {
				return i;
			}
		}
		return -1;
	},

	booleans = "checked|selected|async|autofocus|autoplay|controls|defer|disabled|hidden|ismap|loop|multiple|open|readonly|required|scoped",

	// Regular expressions

	// Whitespace characters http://www.w3.org/TR/css3-selectors/#whitespace
	whitespace = "[\\x20\\t\\r\\n\\f]",
	// http://www.w3.org/TR/css3-syntax/#characters
	characterEncoding = "(?:\\\\.|[\\w-]|[^\\x00-\\xa0])+",

	// Loosely modeled on CSS identifier characters
	// An unquoted value should be a CSS identifier http://www.w3.org/TR/css3-selectors/#attribute-selectors
	// Proper syntax: http://www.w3.org/TR/CSS21/syndata.html#value-def-identifier
	identifier = characterEncoding.replace( "w", "w#" ),

	// Attribute selectors: http://www.w3.org/TR/selectors/#attribute-selectors
	attributes = "\\[" + whitespace + "*(" + characterEncoding + ")(?:" + whitespace +
		// Operator (capture 2)
		"*([*^$|!~]?=)" + whitespace +
		// "Attribute values must be CSS identifiers [capture 5] or strings [capture 3 or capture 4]"
		"*(?:'((?:\\\\.|[^\\\\'])*)'|\"((?:\\\\.|[^\\\\\"])*)\"|(" + identifier + "))|)" + whitespace +
		"*\\]",

	pseudos = ":(" + characterEncoding + ")(?:\\((" +
		// To reduce the number of selectors needing tokenize in the preFilter, prefer arguments:
		// 1. quoted (capture 3; capture 4 or capture 5)
		"('((?:\\\\.|[^\\\\'])*)'|\"((?:\\\\.|[^\\\\\"])*)\")|" +
		// 2. simple (capture 6)
		"((?:\\\\.|[^\\\\()[\\]]|" + attributes + ")*)|" +
		// 3. anything else (capture 2)
		".*" +
		")\\)|)",

	// Leading and non-escaped trailing whitespace, capturing some non-whitespace characters preceding the latter
	rwhitespace = new RegExp( whitespace + "+", "g" ),
	rtrim = new RegExp( "^" + whitespace + "+|((?:^|[^\\\\])(?:\\\\.)*)" + whitespace + "+$", "g" ),

	rcomma = new RegExp( "^" + whitespace + "*," + whitespace + "*" ),
	rcombinators = new RegExp( "^" + whitespace + "*([>+~]|" + whitespace + ")" + whitespace + "*" ),

	rattributeQuotes = new RegExp( "=" + whitespace + "*([^\\]'\"]*?)" + whitespace + "*\\]", "g" ),

	rpseudo = new RegExp( pseudos ),
	ridentifier = new RegExp( "^" + identifier + "$" ),

	matchExpr = {
		"ID": new RegExp( "^#(" + characterEncoding + ")" ),
		"CLASS": new RegExp( "^\\.(" + characterEncoding + ")" ),
		"TAG": new RegExp( "^(" + characterEncoding.replace( "w", "w*" ) + ")" ),
		"ATTR": new RegExp( "^" + attributes ),
		"PSEUDO": new RegExp( "^" + pseudos ),
		"CHILD": new RegExp( "^:(only|first|last|nth|nth-last)-(child|of-type)(?:\\(" + whitespace +
			"*(even|odd|(([+-]|)(\\d*)n|)" + whitespace + "*(?:([+-]|)" + whitespace +
			"*(\\d+)|))" + whitespace + "*\\)|)", "i" ),
		"bool": new RegExp( "^(?:" + booleans + ")$", "i" ),
		// For use in libraries implementing .is()
		// We use this for POS matching in `select`
		"needsContext": new RegExp( "^" + whitespace + "*[>+~]|:(even|odd|eq|gt|lt|nth|first|last)(?:\\(" +
			whitespace + "*((?:-\\d)?\\d*)" + whitespace + "*\\)|)(?=[^-]|$)", "i" )
	},

	rinputs = /^(?:input|select|textarea|button)$/i,
	rheader = /^h\d$/i,

	rnative = /^[^{]+\{\s*\[native \w/,

	// Easily-parseable/retrievable ID or TAG or CLASS selectors
	rquickExpr = /^(?:#([\w-]+)|(\w+)|\.([\w-]+))$/,

	rsibling = /[+~]/,
	rescape = /'|\\/g,

	// CSS escapes http://www.w3.org/TR/CSS21/syndata.html#escaped-characters
	runescape = new RegExp( "\\\\([\\da-f]{1,6}" + whitespace + "?|(" + whitespace + ")|.)", "ig" ),
	funescape = function( _, escaped, escapedWhitespace ) {
		var high = "0x" + escaped - 0x10000;
		// NaN means non-codepoint
		// Support: Firefox<24
		// Workaround erroneous numeric interpretation of +"0x"
		return high !== high || escapedWhitespace ?
			escaped :
			high < 0 ?
				// BMP codepoint
				String.fromCharCode( high + 0x10000 ) :
				// Supplemental Plane codepoint (surrogate pair)
				String.fromCharCode( high >> 10 | 0xD800, high & 0x3FF | 0xDC00 );
	},

	// Used for iframes
	// See setDocument()
	// Removing the function wrapper causes a "Permission Denied"
	// error in IE
	unloadHandler = function() {
		setDocument();
	};

// Optimize for push.apply( _, NodeList )
try {
	push.apply(
		(arr = slice.call( preferredDoc.childNodes )),
		preferredDoc.childNodes
	);
	// Support: Android<4.0
	// Detect silently failing push.apply
	arr[ preferredDoc.childNodes.length ].nodeType;
} catch ( e ) {
	push = { apply: arr.length ?

		// Leverage slice if possible
		function( target, els ) {
			push_native.apply( target, slice.call(els) );
		} :

		// Support: IE<9
		// Otherwise append directly
		function( target, els ) {
			var j = target.length,
				i = 0;
			// Can't trust NodeList.length
			while ( (target[j++] = els[i++]) ) {}
			target.length = j - 1;
		}
	};
}

function Sizzle( selector, context, results, seed ) {
	var match, elem, m, nodeType,
		// QSA vars
		i, groups, old, nid, newContext, newSelector;

	if ( ( context ? context.ownerDocument || context : preferredDoc ) !== document ) {
		setDocument( context );
	}

	context = context || document;
	results = results || [];
	nodeType = context.nodeType;

	if ( typeof selector !== "string" || !selector ||
		nodeType !== 1 && nodeType !== 9 && nodeType !== 11 ) {

		return results;
	}

	if ( !seed && documentIsHTML ) {

		// Try to shortcut find operations when possible (e.g., not under DocumentFragment)
		if ( nodeType !== 11 && (match = rquickExpr.exec( selector )) ) {
			// Speed-up: Sizzle("#ID")
			if ( (m = match[1]) ) {
				if ( nodeType === 9 ) {
					elem = context.getElementById( m );
					// Check parentNode to catch when Blackberry 4.6 returns
					// nodes that are no longer in the document (jQuery #6963)
					if ( elem && elem.parentNode ) {
						// Handle the case where IE, Opera, and Webkit return items
						// by name instead of ID
						if ( elem.id === m ) {
							results.push( elem );
							return results;
						}
					} else {
						return results;
					}
				} else {
					// Context is not a document
					if ( context.ownerDocument && (elem = context.ownerDocument.getElementById( m )) &&
						contains( context, elem ) && elem.id === m ) {
						results.push( elem );
						return results;
					}
				}

			// Speed-up: Sizzle("TAG")
			} else if ( match[2] ) {
				push.apply( results, context.getElementsByTagName( selector ) );
				return results;

			// Speed-up: Sizzle(".CLASS")
			} else if ( (m = match[3]) && support.getElementsByClassName ) {
				push.apply( results, context.getElementsByClassName( m ) );
				return results;
			}
		}

		// QSA path
		if ( support.qsa && (!rbuggyQSA || !rbuggyQSA.test( selector )) ) {
			nid = old = expando;
			newContext = context;
			newSelector = nodeType !== 1 && selector;

			// qSA works strangely on Element-rooted queries
			// We can work around this by specifying an extra ID on the root
			// and working up from there (Thanks to Andrew Dupont for the technique)
			// IE 8 doesn't work on object elements
			if ( nodeType === 1 && context.nodeName.toLowerCase() !== "object" ) {
				groups = tokenize( selector );

				if ( (old = context.getAttribute("id")) ) {
					nid = old.replace( rescape, "\\$&" );
				} else {
					context.setAttribute( "id", nid );
				}
				nid = "[id='" + nid + "'] ";

				i = groups.length;
				while ( i-- ) {
					groups[i] = nid + toSelector( groups[i] );
				}
				newContext = rsibling.test( selector ) && testContext( context.parentNode ) || context;
				newSelector = groups.join(",");
			}

			if ( newSelector ) {
				try {
					push.apply( results,
						newContext.querySelectorAll( newSelector )
					);
					return results;
				} catch(qsaError) {
				} finally {
					if ( !old ) {
						context.removeAttribute("id");
					}
				}
			}
		}
	}

	// All others
	return select( selector.replace( rtrim, "$1" ), context, results, seed );
}

/**
 * Create key-value caches of limited size
 * @returns {Function(string, Object)} Returns the Object data after storing it on itself with
 *	property name the (space-suffixed) string and (if the cache is larger than Expr.cacheLength)
 *	deleting the oldest entry
 */
function createCache() {
	var keys = [];

	function cache( key, value ) {
		// Use (key + " ") to avoid collision with native prototype properties (see Issue #157)
		if ( keys.push( key + " " ) > Expr.cacheLength ) {
			// Only keep the most recent entries
			delete cache[ keys.shift() ];
		}
		return (cache[ key + " " ] = value);
	}
	return cache;
}

/**
 * Mark a function for special use by Sizzle
 * @param {Function} fn The function to mark
 */
function markFunction( fn ) {
	fn[ expando ] = true;
	return fn;
}

/**
 * Support testing using an element
 * @param {Function} fn Passed the created div and expects a boolean result
 */
function assert( fn ) {
	var div = document.createElement("div");

	try {
		return !!fn( div );
	} catch (e) {
		return false;
	} finally {
		// Remove from its parent by default
		if ( div.parentNode ) {
			div.parentNode.removeChild( div );
		}
		// release memory in IE
		div = null;
	}
}

/**
 * Adds the same handler for all of the specified attrs
 * @param {String} attrs Pipe-separated list of attributes
 * @param {Function} handler The method that will be applied
 */
function addHandle( attrs, handler ) {
	var arr = attrs.split("|"),
		i = attrs.length;

	while ( i-- ) {
		Expr.attrHandle[ arr[i] ] = handler;
	}
}

/**
 * Checks document order of two siblings
 * @param {Element} a
 * @param {Element} b
 * @returns {Number} Returns less than 0 if a precedes b, greater than 0 if a follows b
 */
function siblingCheck( a, b ) {
	var cur = b && a,
		diff = cur && a.nodeType === 1 && b.nodeType === 1 &&
			( ~b.sourceIndex || MAX_NEGATIVE ) -
			( ~a.sourceIndex || MAX_NEGATIVE );

	// Use IE sourceIndex if available on both nodes
	if ( diff ) {
		return diff;
	}

	// Check if b follows a
	if ( cur ) {
		while ( (cur = cur.nextSibling) ) {
			if ( cur === b ) {
				return -1;
			}
		}
	}

	return a ? 1 : -1;
}

/**
 * Returns a function to use in pseudos for input types
 * @param {String} type
 */
function createInputPseudo( type ) {
	return function( elem ) {
		var name = elem.nodeName.toLowerCase();
		return name === "input" && elem.type === type;
	};
}

/**
 * Returns a function to use in pseudos for buttons
 * @param {String} type
 */
function createButtonPseudo( type ) {
	return function( elem ) {
		var name = elem.nodeName.toLowerCase();
		return (name === "input" || name === "button") && elem.type === type;
	};
}

/**
 * Returns a function to use in pseudos for positionals
 * @param {Function} fn
 */
function createPositionalPseudo( fn ) {
	return markFunction(function( argument ) {
		argument = +argument;
		return markFunction(function( seed, matches ) {
			var j,
				matchIndexes = fn( [], seed.length, argument ),
				i = matchIndexes.length;

			// Match elements found at the specified indexes
			while ( i-- ) {
				if ( seed[ (j = matchIndexes[i]) ] ) {
					seed[j] = !(matches[j] = seed[j]);
				}
			}
		});
	});
}

/**
 * Checks a node for validity as a Sizzle context
 * @param {Element|Object=} context
 * @returns {Element|Object|Boolean} The input node if acceptable, otherwise a falsy value
 */
function testContext( context ) {
	return context && typeof context.getElementsByTagName !== "undefined" && context;
}

// Expose support vars for convenience
support = Sizzle.support = {};

/**
 * Detects XML nodes
 * @param {Element|Object} elem An element or a document
 * @returns {Boolean} True iff elem is a non-HTML XML node
 */
isXML = Sizzle.isXML = function( elem ) {
	// documentElement is verified for cases where it doesn't yet exist
	// (such as loading iframes in IE - #4833)
	var documentElement = elem && (elem.ownerDocument || elem).documentElement;
	return documentElement ? documentElement.nodeName !== "HTML" : false;
};

/**
 * Sets document-related variables once based on the current document
 * @param {Element|Object} [doc] An element or document object to use to set the document
 * @returns {Object} Returns the current document
 */
setDocument = Sizzle.setDocument = function( node ) {
	var hasCompare, parent,
		doc = node ? node.ownerDocument || node : preferredDoc;

	// If no document and documentElement is available, return
	if ( doc === document || doc.nodeType !== 9 || !doc.documentElement ) {
		return document;
	}

	// Set our document
	document = doc;
	docElem = doc.documentElement;
	parent = doc.defaultView;

	// Support: IE>8
	// If iframe document is assigned to "document" variable and if iframe has been reloaded,
	// IE will throw "permission denied" error when accessing "document" variable, see jQuery #13936
	// IE6-8 do not support the defaultView property so parent will be undefined
	if ( parent && parent !== parent.top ) {
		// IE11 does not have attachEvent, so all must suffer
		if ( parent.addEventListener ) {
			parent.addEventListener( "unload", unloadHandler, false );
		} else if ( parent.attachEvent ) {
			parent.attachEvent( "onunload", unloadHandler );
		}
	}

	/* Support tests
	---------------------------------------------------------------------- */
	documentIsHTML = !isXML( doc );

	/* Attributes
	---------------------------------------------------------------------- */

	// Support: IE<8
	// Verify that getAttribute really returns attributes and not properties
	// (excepting IE8 booleans)
	support.attributes = assert(function( div ) {
		div.className = "i";
		return !div.getAttribute("className");
	});

	/* getElement(s)By*
	---------------------------------------------------------------------- */

	// Check if getElementsByTagName("*") returns only elements
	support.getElementsByTagName = assert(function( div ) {
		div.appendChild( doc.createComment("") );
		return !div.getElementsByTagName("*").length;
	});

	// Support: IE<9
	support.getElementsByClassName = rnative.test( doc.getElementsByClassName );

	// Support: IE<10
	// Check if getElementById returns elements by name
	// The broken getElementById methods don't pick up programatically-set names,
	// so use a roundabout getElementsByName test
	support.getById = assert(function( div ) {
		docElem.appendChild( div ).id = expando;
		return !doc.getElementsByName || !doc.getElementsByName( expando ).length;
	});

	// ID find and filter
	if ( support.getById ) {
		Expr.find["ID"] = function( id, context ) {
			if ( typeof context.getElementById !== "undefined" && documentIsHTML ) {
				var m = context.getElementById( id );
				// Check parentNode to catch when Blackberry 4.6 returns
				// nodes that are no longer in the document #6963
				return m && m.parentNode ? [ m ] : [];
			}
		};
		Expr.filter["ID"] = function( id ) {
			var attrId = id.replace( runescape, funescape );
			return function( elem ) {
				return elem.getAttribute("id") === attrId;
			};
		};
	} else {
		// Support: IE6/7
		// getElementById is not reliable as a find shortcut
		delete Expr.find["ID"];

		Expr.filter["ID"] =  function( id ) {
			var attrId = id.replace( runescape, funescape );
			return function( elem ) {
				var node = typeof elem.getAttributeNode !== "undefined" && elem.getAttributeNode("id");
				return node && node.value === attrId;
			};
		};
	}

	// Tag
	Expr.find["TAG"] = support.getElementsByTagName ?
		function( tag, context ) {
			if ( typeof context.getElementsByTagName !== "undefined" ) {
				return context.getElementsByTagName( tag );

			// DocumentFragment nodes don't have gEBTN
			} else if ( support.qsa ) {
				return context.querySelectorAll( tag );
			}
		} :

		function( tag, context ) {
			var elem,
				tmp = [],
				i = 0,
				// By happy coincidence, a (broken) gEBTN appears on DocumentFragment nodes too
				results = context.getElementsByTagName( tag );

			// Filter out possible comments
			if ( tag === "*" ) {
				while ( (elem = results[i++]) ) {
					if ( elem.nodeType === 1 ) {
						tmp.push( elem );
					}
				}

				return tmp;
			}
			return results;
		};

	// Class
	Expr.find["CLASS"] = support.getElementsByClassName && function( className, context ) {
		if ( documentIsHTML ) {
			return context.getElementsByClassName( className );
		}
	};

	/* QSA/matchesSelector
	---------------------------------------------------------------------- */

	// QSA and matchesSelector support

	// matchesSelector(:active) reports false when true (IE9/Opera 11.5)
	rbuggyMatches = [];

	// qSa(:focus) reports false when true (Chrome 21)
	// We allow this because of a bug in IE8/9 that throws an error
	// whenever `document.activeElement` is accessed on an iframe
	// So, we allow :focus to pass through QSA all the time to avoid the IE error
	// See http://bugs.jquery.com/ticket/13378
	rbuggyQSA = [];

	if ( (support.qsa = rnative.test( doc.querySelectorAll )) ) {
		// Build QSA regex
		// Regex strategy adopted from Diego Perini
		assert(function( div ) {
			// Select is set to empty string on purpose
			// This is to test IE's treatment of not explicitly
			// setting a boolean content attribute,
			// since its presence should be enough
			// http://bugs.jquery.com/ticket/12359
			docElem.appendChild( div ).innerHTML = "<a id='" + expando + "'></a>" +
				"<select id='" + expando + "-\f]' msallowcapture=''>" +
				"<option selected=''></option></select>";

			// Support: IE8, Opera 11-12.16
			// Nothing should be selected when empty strings follow ^= or $= or *=
			// The test attribute must be unknown in Opera but "safe" for WinRT
			// http://msdn.microsoft.com/en-us/library/ie/hh465388.aspx#attribute_section
			if ( div.querySelectorAll("[msallowcapture^='']").length ) {
				rbuggyQSA.push( "[*^$]=" + whitespace + "*(?:''|\"\")" );
			}

			// Support: IE8
			// Boolean attributes and "value" are not treated correctly
			if ( !div.querySelectorAll("[selected]").length ) {
				rbuggyQSA.push( "\\[" + whitespace + "*(?:value|" + booleans + ")" );
			}

			// Support: Chrome<29, Android<4.2+, Safari<7.0+, iOS<7.0+, PhantomJS<1.9.7+
			if ( !div.querySelectorAll( "[id~=" + expando + "-]" ).length ) {
				rbuggyQSA.push("~=");
			}

			// Webkit/Opera - :checked should return selected option elements
			// http://www.w3.org/TR/2011/REC-css3-selectors-20110929/#checked
			// IE8 throws error here and will not see later tests
			if ( !div.querySelectorAll(":checked").length ) {
				rbuggyQSA.push(":checked");
			}

			// Support: Safari 8+, iOS 8+
			// https://bugs.webkit.org/show_bug.cgi?id=136851
			// In-page `selector#id sibing-combinator selector` fails
			if ( !div.querySelectorAll( "a#" + expando + "+*" ).length ) {
				rbuggyQSA.push(".#.+[+~]");
			}
		});

		assert(function( div ) {
			// Support: Windows 8 Native Apps
			// The type and name attributes are restricted during .innerHTML assignment
			var input = doc.createElement("input");
			input.setAttribute( "type", "hidden" );
			div.appendChild( input ).setAttribute( "name", "D" );

			// Support: IE8
			// Enforce case-sensitivity of name attribute
			if ( div.querySelectorAll("[name=d]").length ) {
				rbuggyQSA.push( "name" + whitespace + "*[*^$|!~]?=" );
			}

			// FF 3.5 - :enabled/:disabled and hidden elements (hidden elements are still enabled)
			// IE8 throws error here and will not see later tests
			if ( !div.querySelectorAll(":enabled").length ) {
				rbuggyQSA.push( ":enabled", ":disabled" );
			}

			// Opera 10-11 does not throw on post-comma invalid pseudos
			div.querySelectorAll("*,:x");
			rbuggyQSA.push(",.*:");
		});
	}

	if ( (support.matchesSelector = rnative.test( (matches = docElem.matches ||
		docElem.webkitMatchesSelector ||
		docElem.mozMatchesSelector ||
		docElem.oMatchesSelector ||
		docElem.msMatchesSelector) )) ) {

		assert(function( div ) {
			// Check to see if it's possible to do matchesSelector
			// on a disconnected node (IE 9)
			support.disconnectedMatch = matches.call( div, "div" );

			// This should fail with an exception
			// Gecko does not error, returns false instead
			matches.call( div, "[s!='']:x" );
			rbuggyMatches.push( "!=", pseudos );
		});
	}

	rbuggyQSA = rbuggyQSA.length && new RegExp( rbuggyQSA.join("|") );
	rbuggyMatches = rbuggyMatches.length && new RegExp( rbuggyMatches.join("|") );

	/* Contains
	---------------------------------------------------------------------- */
	hasCompare = rnative.test( docElem.compareDocumentPosition );

	// Element contains another
	// Purposefully does not implement inclusive descendent
	// As in, an element does not contain itself
	contains = hasCompare || rnative.test( docElem.contains ) ?
		function( a, b ) {
			var adown = a.nodeType === 9 ? a.documentElement : a,
				bup = b && b.parentNode;
			return a === bup || !!( bup && bup.nodeType === 1 && (
				adown.contains ?
					adown.contains( bup ) :
					a.compareDocumentPosition && a.compareDocumentPosition( bup ) & 16
			));
		} :
		function( a, b ) {
			if ( b ) {
				while ( (b = b.parentNode) ) {
					if ( b === a ) {
						return true;
					}
				}
			}
			return false;
		};

	/* Sorting
	---------------------------------------------------------------------- */

	// Document order sorting
	sortOrder = hasCompare ?
	function( a, b ) {

		// Flag for duplicate removal
		if ( a === b ) {
			hasDuplicate = true;
			return 0;
		}

		// Sort on method existence if only one input has compareDocumentPosition
		var compare = !a.compareDocumentPosition - !b.compareDocumentPosition;
		if ( compare ) {
			return compare;
		}

		// Calculate position if both inputs belong to the same document
		compare = ( a.ownerDocument || a ) === ( b.ownerDocument || b ) ?
			a.compareDocumentPosition( b ) :

			// Otherwise we know they are disconnected
			1;

		// Disconnected nodes
		if ( compare & 1 ||
			(!support.sortDetached && b.compareDocumentPosition( a ) === compare) ) {

			// Choose the first element that is related to our preferred document
			if ( a === doc || a.ownerDocument === preferredDoc && contains(preferredDoc, a) ) {
				return -1;
			}
			if ( b === doc || b.ownerDocument === preferredDoc && contains(preferredDoc, b) ) {
				return 1;
			}

			// Maintain original order
			return sortInput ?
				( indexOf( sortInput, a ) - indexOf( sortInput, b ) ) :
				0;
		}

		return compare & 4 ? -1 : 1;
	} :
	function( a, b ) {
		// Exit early if the nodes are identical
		if ( a === b ) {
			hasDuplicate = true;
			return 0;
		}

		var cur,
			i = 0,
			aup = a.parentNode,
			bup = b.parentNode,
			ap = [ a ],
			bp = [ b ];

		// Parentless nodes are either documents or disconnected
		if ( !aup || !bup ) {
			return a === doc ? -1 :
				b === doc ? 1 :
				aup ? -1 :
				bup ? 1 :
				sortInput ?
				( indexOf( sortInput, a ) - indexOf( sortInput, b ) ) :
				0;

		// If the nodes are siblings, we can do a quick check
		} else if ( aup === bup ) {
			return siblingCheck( a, b );
		}

		// Otherwise we need full lists of their ancestors for comparison
		cur = a;
		while ( (cur = cur.parentNode) ) {
			ap.unshift( cur );
		}
		cur = b;
		while ( (cur = cur.parentNode) ) {
			bp.unshift( cur );
		}

		// Walk down the tree looking for a discrepancy
		while ( ap[i] === bp[i] ) {
			i++;
		}

		return i ?
			// Do a sibling check if the nodes have a common ancestor
			siblingCheck( ap[i], bp[i] ) :

			// Otherwise nodes in our document sort first
			ap[i] === preferredDoc ? -1 :
			bp[i] === preferredDoc ? 1 :
			0;
	};

	return doc;
};

Sizzle.matches = function( expr, elements ) {
	return Sizzle( expr, null, null, elements );
};

Sizzle.matchesSelector = function( elem, expr ) {
	// Set document vars if needed
	if ( ( elem.ownerDocument || elem ) !== document ) {
		setDocument( elem );
	}

	// Make sure that attribute selectors are quoted
	expr = expr.replace( rattributeQuotes, "='$1']" );

	if ( support.matchesSelector && documentIsHTML &&
		( !rbuggyMatches || !rbuggyMatches.test( expr ) ) &&
		( !rbuggyQSA     || !rbuggyQSA.test( expr ) ) ) {

		try {
			var ret = matches.call( elem, expr );

			// IE 9's matchesSelector returns false on disconnected nodes
			if ( ret || support.disconnectedMatch ||
					// As well, disconnected nodes are said to be in a document
					// fragment in IE 9
					elem.document && elem.document.nodeType !== 11 ) {
				return ret;
			}
		} catch (e) {}
	}

	return Sizzle( expr, document, null, [ elem ] ).length > 0;
};

Sizzle.contains = function( context, elem ) {
	// Set document vars if needed
	if ( ( context.ownerDocument || context ) !== document ) {
		setDocument( context );
	}
	return contains( context, elem );
};

Sizzle.attr = function( elem, name ) {
	// Set document vars if needed
	if ( ( elem.ownerDocument || elem ) !== document ) {
		setDocument( elem );
	}

	var fn = Expr.attrHandle[ name.toLowerCase() ],
		// Don't get fooled by Object.prototype properties (jQuery #13807)
		val = fn && hasOwn.call( Expr.attrHandle, name.toLowerCase() ) ?
			fn( elem, name, !documentIsHTML ) :
			undefined;

	return val !== undefined ?
		val :
		support.attributes || !documentIsHTML ?
			elem.getAttribute( name ) :
			(val = elem.getAttributeNode(name)) && val.specified ?
				val.value :
				null;
};

Sizzle.error = function( msg ) {
	throw new Error( "Syntax error, unrecognized expression: " + msg );
};

/**
 * Document sorting and removing duplicates
 * @param {ArrayLike} results
 */
Sizzle.uniqueSort = function( results ) {
	var elem,
		duplicates = [],
		j = 0,
		i = 0;

	// Unless we *know* we can detect duplicates, assume their presence
	hasDuplicate = !support.detectDuplicates;
	sortInput = !support.sortStable && results.slice( 0 );
	results.sort( sortOrder );

	if ( hasDuplicate ) {
		while ( (elem = results[i++]) ) {
			if ( elem === results[ i ] ) {
				j = duplicates.push( i );
			}
		}
		while ( j-- ) {
			results.splice( duplicates[ j ], 1 );
		}
	}

	// Clear input after sorting to release objects
	// See https://github.com/jquery/sizzle/pull/225
	sortInput = null;

	return results;
};

/**
 * Utility function for retrieving the text value of an array of DOM nodes
 * @param {Array|Element} elem
 */
getText = Sizzle.getText = function( elem ) {
	var node,
		ret = "",
		i = 0,
		nodeType = elem.nodeType;

	if ( !nodeType ) {
		// If no nodeType, this is expected to be an array
		while ( (node = elem[i++]) ) {
			// Do not traverse comment nodes
			ret += getText( node );
		}
	} else if ( nodeType === 1 || nodeType === 9 || nodeType === 11 ) {
		// Use textContent for elements
		// innerText usage removed for consistency of new lines (jQuery #11153)
		if ( typeof elem.textContent === "string" ) {
			return elem.textContent;
		} else {
			// Traverse its children
			for ( elem = elem.firstChild; elem; elem = elem.nextSibling ) {
				ret += getText( elem );
			}
		}
	} else if ( nodeType === 3 || nodeType === 4 ) {
		return elem.nodeValue;
	}
	// Do not include comment or processing instruction nodes

	return ret;
};

Expr = Sizzle.selectors = {

	// Can be adjusted by the user
	cacheLength: 50,

	createPseudo: markFunction,

	match: matchExpr,

	attrHandle: {},

	find: {},

	relative: {
		">": { dir: "parentNode", first: true },
		" ": { dir: "parentNode" },
		"+": { dir: "previousSibling", first: true },
		"~": { dir: "previousSibling" }
	},

	preFilter: {
		"ATTR": function( match ) {
			match[1] = match[1].replace( runescape, funescape );

			// Move the given value to match[3] whether quoted or unquoted
			match[3] = ( match[3] || match[4] || match[5] || "" ).replace( runescape, funescape );

			if ( match[2] === "~=" ) {
				match[3] = " " + match[3] + " ";
			}

			return match.slice( 0, 4 );
		},

		"CHILD": function( match ) {
			/* matches from matchExpr["CHILD"]
				1 type (only|nth|...)
				2 what (child|of-type)
				3 argument (even|odd|\d*|\d*n([+-]\d+)?|...)
				4 xn-component of xn+y argument ([+-]?\d*n|)
				5 sign of xn-component
				6 x of xn-component
				7 sign of y-component
				8 y of y-component
			*/
			match[1] = match[1].toLowerCase();

			if ( match[1].slice( 0, 3 ) === "nth" ) {
				// nth-* requires argument
				if ( !match[3] ) {
					Sizzle.error( match[0] );
				}

				// numeric x and y parameters for Expr.filter.CHILD
				// remember that false/true cast respectively to 0/1
				match[4] = +( match[4] ? match[5] + (match[6] || 1) : 2 * ( match[3] === "even" || match[3] === "odd" ) );
				match[5] = +( ( match[7] + match[8] ) || match[3] === "odd" );

			// other types prohibit arguments
			} else if ( match[3] ) {
				Sizzle.error( match[0] );
			}

			return match;
		},

		"PSEUDO": function( match ) {
			var excess,
				unquoted = !match[6] && match[2];

			if ( matchExpr["CHILD"].test( match[0] ) ) {
				return null;
			}

			// Accept quoted arguments as-is
			if ( match[3] ) {
				match[2] = match[4] || match[5] || "";

			// Strip excess characters from unquoted arguments
			} else if ( unquoted && rpseudo.test( unquoted ) &&
				// Get excess from tokenize (recursively)
				(excess = tokenize( unquoted, true )) &&
				// advance to the next closing parenthesis
				(excess = unquoted.indexOf( ")", unquoted.length - excess ) - unquoted.length) ) {

				// excess is a negative index
				match[0] = match[0].slice( 0, excess );
				match[2] = unquoted.slice( 0, excess );
			}

			// Return only captures needed by the pseudo filter method (type and argument)
			return match.slice( 0, 3 );
		}
	},

	filter: {

		"TAG": function( nodeNameSelector ) {
			var nodeName = nodeNameSelector.replace( runescape, funescape ).toLowerCase();
			return nodeNameSelector === "*" ?
				function() { return true; } :
				function( elem ) {
					return elem.nodeName && elem.nodeName.toLowerCase() === nodeName;
				};
		},

		"CLASS": function( className ) {
			var pattern = classCache[ className + " " ];

			return pattern ||
				(pattern = new RegExp( "(^|" + whitespace + ")" + className + "(" + whitespace + "|$)" )) &&
				classCache( className, function( elem ) {
					return pattern.test( typeof elem.className === "string" && elem.className || typeof elem.getAttribute !== "undefined" && elem.getAttribute("class") || "" );
				});
		},

		"ATTR": function( name, operator, check ) {
			return function( elem ) {
				var result = Sizzle.attr( elem, name );

				if ( result == null ) {
					return operator === "!=";
				}
				if ( !operator ) {
					return true;
				}

				result += "";

				return operator === "=" ? result === check :
					operator === "!=" ? result !== check :
					operator === "^=" ? check && result.indexOf( check ) === 0 :
					operator === "*=" ? check && result.indexOf( check ) > -1 :
					operator === "$=" ? check && result.slice( -check.length ) === check :
					operator === "~=" ? ( " " + result.replace( rwhitespace, " " ) + " " ).indexOf( check ) > -1 :
					operator === "|=" ? result === check || result.slice( 0, check.length + 1 ) === check + "-" :
					false;
			};
		},

		"CHILD": function( type, what, argument, first, last ) {
			var simple = type.slice( 0, 3 ) !== "nth",
				forward = type.slice( -4 ) !== "last",
				ofType = what === "of-type";

			return first === 1 && last === 0 ?

				// Shortcut for :nth-*(n)
				function( elem ) {
					return !!elem.parentNode;
				} :

				function( elem, context, xml ) {
					var cache, outerCache, node, diff, nodeIndex, start,
						dir = simple !== forward ? "nextSibling" : "previousSibling",
						parent = elem.parentNode,
						name = ofType && elem.nodeName.toLowerCase(),
						useCache = !xml && !ofType;

					if ( parent ) {

						// :(first|last|only)-(child|of-type)
						if ( simple ) {
							while ( dir ) {
								node = elem;
								while ( (node = node[ dir ]) ) {
									if ( ofType ? node.nodeName.toLowerCase() === name : node.nodeType === 1 ) {
										return false;
									}
								}
								// Reverse direction for :only-* (if we haven't yet done so)
								start = dir = type === "only" && !start && "nextSibling";
							}
							return true;
						}

						start = [ forward ? parent.firstChild : parent.lastChild ];

						// non-xml :nth-child(...) stores cache data on `parent`
						if ( forward && useCache ) {
							// Seek `elem` from a previously-cached index
							outerCache = parent[ expando ] || (parent[ expando ] = {});
							cache = outerCache[ type ] || [];
							nodeIndex = cache[0] === dirruns && cache[1];
							diff = cache[0] === dirruns && cache[2];
							node = nodeIndex && parent.childNodes[ nodeIndex ];

							while ( (node = ++nodeIndex && node && node[ dir ] ||

								// Fallback to seeking `elem` from the start
								(diff = nodeIndex = 0) || start.pop()) ) {

								// When found, cache indexes on `parent` and break
								if ( node.nodeType === 1 && ++diff && node === elem ) {
									outerCache[ type ] = [ dirruns, nodeIndex, diff ];
									break;
								}
							}

						// Use previously-cached element index if available
						} else if ( useCache && (cache = (elem[ expando ] || (elem[ expando ] = {}))[ type ]) && cache[0] === dirruns ) {
							diff = cache[1];

						// xml :nth-child(...) or :nth-last-child(...) or :nth(-last)?-of-type(...)
						} else {
							// Use the same loop as above to seek `elem` from the start
							while ( (node = ++nodeIndex && node && node[ dir ] ||
								(diff = nodeIndex = 0) || start.pop()) ) {

								if ( ( ofType ? node.nodeName.toLowerCase() === name : node.nodeType === 1 ) && ++diff ) {
									// Cache the index of each encountered element
									if ( useCache ) {
										(node[ expando ] || (node[ expando ] = {}))[ type ] = [ dirruns, diff ];
									}

									if ( node === elem ) {
										break;
									}
								}
							}
						}

						// Incorporate the offset, then check against cycle size
						diff -= last;
						return diff === first || ( diff % first === 0 && diff / first >= 0 );
					}
				};
		},

		"PSEUDO": function( pseudo, argument ) {
			// pseudo-class names are case-insensitive
			// http://www.w3.org/TR/selectors/#pseudo-classes
			// Prioritize by case sensitivity in case custom pseudos are added with uppercase letters
			// Remember that setFilters inherits from pseudos
			var args,
				fn = Expr.pseudos[ pseudo ] || Expr.setFilters[ pseudo.toLowerCase() ] ||
					Sizzle.error( "unsupported pseudo: " + pseudo );

			// The user may use createPseudo to indicate that
			// arguments are needed to create the filter function
			// just as Sizzle does
			if ( fn[ expando ] ) {
				return fn( argument );
			}

			// But maintain support for old signatures
			if ( fn.length > 1 ) {
				args = [ pseudo, pseudo, "", argument ];
				return Expr.setFilters.hasOwnProperty( pseudo.toLowerCase() ) ?
					markFunction(function( seed, matches ) {
						var idx,
							matched = fn( seed, argument ),
							i = matched.length;
						while ( i-- ) {
							idx = indexOf( seed, matched[i] );
							seed[ idx ] = !( matches[ idx ] = matched[i] );
						}
					}) :
					function( elem ) {
						return fn( elem, 0, args );
					};
			}

			return fn;
		}
	},

	pseudos: {
		// Potentially complex pseudos
		"not": markFunction(function( selector ) {
			// Trim the selector passed to compile
			// to avoid treating leading and trailing
			// spaces as combinators
			var input = [],
				results = [],
				matcher = compile( selector.replace( rtrim, "$1" ) );

			return matcher[ expando ] ?
				markFunction(function( seed, matches, context, xml ) {
					var elem,
						unmatched = matcher( seed, null, xml, [] ),
						i = seed.length;

					// Match elements unmatched by `matcher`
					while ( i-- ) {
						if ( (elem = unmatched[i]) ) {
							seed[i] = !(matches[i] = elem);
						}
					}
				}) :
				function( elem, context, xml ) {
					input[0] = elem;
					matcher( input, null, xml, results );
					// Don't keep the element (issue #299)
					input[0] = null;
					return !results.pop();
				};
		}),

		"has": markFunction(function( selector ) {
			return function( elem ) {
				return Sizzle( selector, elem ).length > 0;
			};
		}),

		"contains": markFunction(function( text ) {
			text = text.replace( runescape, funescape );
			return function( elem ) {
				return ( elem.textContent || elem.innerText || getText( elem ) ).indexOf( text ) > -1;
			};
		}),

		// "Whether an element is represented by a :lang() selector
		// is based solely on the element's language value
		// being equal to the identifier C,
		// or beginning with the identifier C immediately followed by "-".
		// The matching of C against the element's language value is performed case-insensitively.
		// The identifier C does not have to be a valid language name."
		// http://www.w3.org/TR/selectors/#lang-pseudo
		"lang": markFunction( function( lang ) {
			// lang value must be a valid identifier
			if ( !ridentifier.test(lang || "") ) {
				Sizzle.error( "unsupported lang: " + lang );
			}
			lang = lang.replace( runescape, funescape ).toLowerCase();
			return function( elem ) {
				var elemLang;
				do {
					if ( (elemLang = documentIsHTML ?
						elem.lang :
						elem.getAttribute("xml:lang") || elem.getAttribute("lang")) ) {

						elemLang = elemLang.toLowerCase();
						return elemLang === lang || elemLang.indexOf( lang + "-" ) === 0;
					}
				} while ( (elem = elem.parentNode) && elem.nodeType === 1 );
				return false;
			};
		}),

		// Miscellaneous
		"target": function( elem ) {
			var hash = window.location && window.location.hash;
			return hash && hash.slice( 1 ) === elem.id;
		},

		"root": function( elem ) {
			return elem === docElem;
		},

		"focus": function( elem ) {
			return elem === document.activeElement && (!document.hasFocus || document.hasFocus()) && !!(elem.type || elem.href || ~elem.tabIndex);
		},

		// Boolean properties
		"enabled": function( elem ) {
			return elem.disabled === false;
		},

		"disabled": function( elem ) {
			return elem.disabled === true;
		},

		"checked": function( elem ) {
			// In CSS3, :checked should return both checked and selected elements
			// http://www.w3.org/TR/2011/REC-css3-selectors-20110929/#checked
			var nodeName = elem.nodeName.toLowerCase();
			return (nodeName === "input" && !!elem.checked) || (nodeName === "option" && !!elem.selected);
		},

		"selected": function( elem ) {
			// Accessing this property makes selected-by-default
			// options in Safari work properly
			if ( elem.parentNode ) {
				elem.parentNode.selectedIndex;
			}

			return elem.selected === true;
		},

		// Contents
		"empty": function( elem ) {
			// http://www.w3.org/TR/selectors/#empty-pseudo
			// :empty is negated by element (1) or content nodes (text: 3; cdata: 4; entity ref: 5),
			//   but not by others (comment: 8; processing instruction: 7; etc.)
			// nodeType < 6 works because attributes (2) do not appear as children
			for ( elem = elem.firstChild; elem; elem = elem.nextSibling ) {
				if ( elem.nodeType < 6 ) {
					return false;
				}
			}
			return true;
		},

		"parent": function( elem ) {
			return !Expr.pseudos["empty"]( elem );
		},

		// Element/input types
		"header": function( elem ) {
			return rheader.test( elem.nodeName );
		},

		"input": function( elem ) {
			return rinputs.test( elem.nodeName );
		},

		"button": function( elem ) {
			var name = elem.nodeName.toLowerCase();
			return name === "input" && elem.type === "button" || name === "button";
		},

		"text": function( elem ) {
			var attr;
			return elem.nodeName.toLowerCase() === "input" &&
				elem.type === "text" &&

				// Support: IE<8
				// New HTML5 attribute values (e.g., "search") appear with elem.type === "text"
				( (attr = elem.getAttribute("type")) == null || attr.toLowerCase() === "text" );
		},

		// Position-in-collection
		"first": createPositionalPseudo(function() {
			return [ 0 ];
		}),

		"last": createPositionalPseudo(function( matchIndexes, length ) {
			return [ length - 1 ];
		}),

		"eq": createPositionalPseudo(function( matchIndexes, length, argument ) {
			return [ argument < 0 ? argument + length : argument ];
		}),

		"even": createPositionalPseudo(function( matchIndexes, length ) {
			var i = 0;
			for ( ; i < length; i += 2 ) {
				matchIndexes.push( i );
			}
			return matchIndexes;
		}),

		"odd": createPositionalPseudo(function( matchIndexes, length ) {
			var i = 1;
			for ( ; i < length; i += 2 ) {
				matchIndexes.push( i );
			}
			return matchIndexes;
		}),

		"lt": createPositionalPseudo(function( matchIndexes, length, argument ) {
			var i = argument < 0 ? argument + length : argument;
			for ( ; --i >= 0; ) {
				matchIndexes.push( i );
			}
			return matchIndexes;
		}),

		"gt": createPositionalPseudo(function( matchIndexes, length, argument ) {
			var i = argument < 0 ? argument + length : argument;
			for ( ; ++i < length; ) {
				matchIndexes.push( i );
			}
			return matchIndexes;
		})
	}
};

Expr.pseudos["nth"] = Expr.pseudos["eq"];

// Add button/input type pseudos
for ( i in { radio: true, checkbox: true, file: true, password: true, image: true } ) {
	Expr.pseudos[ i ] = createInputPseudo( i );
}
for ( i in { submit: true, reset: true } ) {
	Expr.pseudos[ i ] = createButtonPseudo( i );
}

// Easy API for creating new setFilters
function setFilters() {}
setFilters.prototype = Expr.filters = Expr.pseudos;
Expr.setFilters = new setFilters();

tokenize = Sizzle.tokenize = function( selector, parseOnly ) {
	var matched, match, tokens, type,
		soFar, groups, preFilters,
		cached = tokenCache[ selector + " " ];

	if ( cached ) {
		return parseOnly ? 0 : cached.slice( 0 );
	}

	soFar = selector;
	groups = [];
	preFilters = Expr.preFilter;

	while ( soFar ) {

		// Comma and first run
		if ( !matched || (match = rcomma.exec( soFar )) ) {
			if ( match ) {
				// Don't consume trailing commas as valid
				soFar = soFar.slice( match[0].length ) || soFar;
			}
			groups.push( (tokens = []) );
		}

		matched = false;

		// Combinators
		if ( (match = rcombinators.exec( soFar )) ) {
			matched = match.shift();
			tokens.push({
				value: matched,
				// Cast descendant combinators to space
				type: match[0].replace( rtrim, " " )
			});
			soFar = soFar.slice( matched.length );
		}

		// Filters
		for ( type in Expr.filter ) {
			if ( (match = matchExpr[ type ].exec( soFar )) && (!preFilters[ type ] ||
				(match = preFilters[ type ]( match ))) ) {
				matched = match.shift();
				tokens.push({
					value: matched,
					type: type,
					matches: match
				});
				soFar = soFar.slice( matched.length );
			}
		}

		if ( !matched ) {
			break;
		}
	}

	// Return the length of the invalid excess
	// if we're just parsing
	// Otherwise, throw an error or return tokens
	return parseOnly ?
		soFar.length :
		soFar ?
			Sizzle.error( selector ) :
			// Cache the tokens
			tokenCache( selector, groups ).slice( 0 );
};

function toSelector( tokens ) {
	var i = 0,
		len = tokens.length,
		selector = "";
	for ( ; i < len; i++ ) {
		selector += tokens[i].value;
	}
	return selector;
}

function addCombinator( matcher, combinator, base ) {
	var dir = combinator.dir,
		checkNonElements = base && dir === "parentNode",
		doneName = done++;

	return combinator.first ?
		// Check against closest ancestor/preceding element
		function( elem, context, xml ) {
			while ( (elem = elem[ dir ]) ) {
				if ( elem.nodeType === 1 || checkNonElements ) {
					return matcher( elem, context, xml );
				}
			}
		} :

		// Check against all ancestor/preceding elements
		function( elem, context, xml ) {
			var oldCache, outerCache,
				newCache = [ dirruns, doneName ];

			// We can't set arbitrary data on XML nodes, so they don't benefit from dir caching
			if ( xml ) {
				while ( (elem = elem[ dir ]) ) {
					if ( elem.nodeType === 1 || checkNonElements ) {
						if ( matcher( elem, context, xml ) ) {
							return true;
						}
					}
				}
			} else {
				while ( (elem = elem[ dir ]) ) {
					if ( elem.nodeType === 1 || checkNonElements ) {
						outerCache = elem[ expando ] || (elem[ expando ] = {});
						if ( (oldCache = outerCache[ dir ]) &&
							oldCache[ 0 ] === dirruns && oldCache[ 1 ] === doneName ) {

							// Assign to newCache so results back-propagate to previous elements
							return (newCache[ 2 ] = oldCache[ 2 ]);
						} else {
							// Reuse newcache so results back-propagate to previous elements
							outerCache[ dir ] = newCache;

							// A match means we're done; a fail means we have to keep checking
							if ( (newCache[ 2 ] = matcher( elem, context, xml )) ) {
								return true;
							}
						}
					}
				}
			}
		};
}

function elementMatcher( matchers ) {
	return matchers.length > 1 ?
		function( elem, context, xml ) {
			var i = matchers.length;
			while ( i-- ) {
				if ( !matchers[i]( elem, context, xml ) ) {
					return false;
				}
			}
			return true;
		} :
		matchers[0];
}

function multipleContexts( selector, contexts, results ) {
	var i = 0,
		len = contexts.length;
	for ( ; i < len; i++ ) {
		Sizzle( selector, contexts[i], results );
	}
	return results;
}

function condense( unmatched, map, filter, context, xml ) {
	var elem,
		newUnmatched = [],
		i = 0,
		len = unmatched.length,
		mapped = map != null;

	for ( ; i < len; i++ ) {
		if ( (elem = unmatched[i]) ) {
			if ( !filter || filter( elem, context, xml ) ) {
				newUnmatched.push( elem );
				if ( mapped ) {
					map.push( i );
				}
			}
		}
	}

	return newUnmatched;
}

function setMatcher( preFilter, selector, matcher, postFilter, postFinder, postSelector ) {
	if ( postFilter && !postFilter[ expando ] ) {
		postFilter = setMatcher( postFilter );
	}
	if ( postFinder && !postFinder[ expando ] ) {
		postFinder = setMatcher( postFinder, postSelector );
	}
	return markFunction(function( seed, results, context, xml ) {
		var temp, i, elem,
			preMap = [],
			postMap = [],
			preexisting = results.length,

			// Get initial elements from seed or context
			elems = seed || multipleContexts( selector || "*", context.nodeType ? [ context ] : context, [] ),

			// Prefilter to get matcher input, preserving a map for seed-results synchronization
			matcherIn = preFilter && ( seed || !selector ) ?
				condense( elems, preMap, preFilter, context, xml ) :
				elems,

			matcherOut = matcher ?
				// If we have a postFinder, or filtered seed, or non-seed postFilter or preexisting results,
				postFinder || ( seed ? preFilter : preexisting || postFilter ) ?

					// ...intermediate processing is necessary
					[] :

					// ...otherwise use results directly
					results :
				matcherIn;

		// Find primary matches
		if ( matcher ) {
			matcher( matcherIn, matcherOut, context, xml );
		}

		// Apply postFilter
		if ( postFilter ) {
			temp = condense( matcherOut, postMap );
			postFilter( temp, [], context, xml );

			// Un-match failing elements by moving them back to matcherIn
			i = temp.length;
			while ( i-- ) {
				if ( (elem = temp[i]) ) {
					matcherOut[ postMap[i] ] = !(matcherIn[ postMap[i] ] = elem);
				}
			}
		}

		if ( seed ) {
			if ( postFinder || preFilter ) {
				if ( postFinder ) {
					// Get the final matcherOut by condensing this intermediate into postFinder contexts
					temp = [];
					i = matcherOut.length;
					while ( i-- ) {
						if ( (elem = matcherOut[i]) ) {
							// Restore matcherIn since elem is not yet a final match
							temp.push( (matcherIn[i] = elem) );
						}
					}
					postFinder( null, (matcherOut = []), temp, xml );
				}

				// Move matched elements from seed to results to keep them synchronized
				i = matcherOut.length;
				while ( i-- ) {
					if ( (elem = matcherOut[i]) &&
						(temp = postFinder ? indexOf( seed, elem ) : preMap[i]) > -1 ) {

						seed[temp] = !(results[temp] = elem);
					}
				}
			}

		// Add elements to results, through postFinder if defined
		} else {
			matcherOut = condense(
				matcherOut === results ?
					matcherOut.splice( preexisting, matcherOut.length ) :
					matcherOut
			);
			if ( postFinder ) {
				postFinder( null, results, matcherOut, xml );
			} else {
				push.apply( results, matcherOut );
			}
		}
	});
}

function matcherFromTokens( tokens ) {
	var checkContext, matcher, j,
		len = tokens.length,
		leadingRelative = Expr.relative[ tokens[0].type ],
		implicitRelative = leadingRelative || Expr.relative[" "],
		i = leadingRelative ? 1 : 0,

		// The foundational matcher ensures that elements are reachable from top-level context(s)
		matchContext = addCombinator( function( elem ) {
			return elem === checkContext;
		}, implicitRelative, true ),
		matchAnyContext = addCombinator( function( elem ) {
			return indexOf( checkContext, elem ) > -1;
		}, implicitRelative, true ),
		matchers = [ function( elem, context, xml ) {
			var ret = ( !leadingRelative && ( xml || context !== outermostContext ) ) || (
				(checkContext = context).nodeType ?
					matchContext( elem, context, xml ) :
					matchAnyContext( elem, context, xml ) );
			// Avoid hanging onto element (issue #299)
			checkContext = null;
			return ret;
		} ];

	for ( ; i < len; i++ ) {
		if ( (matcher = Expr.relative[ tokens[i].type ]) ) {
			matchers = [ addCombinator(elementMatcher( matchers ), matcher) ];
		} else {
			matcher = Expr.filter[ tokens[i].type ].apply( null, tokens[i].matches );

			// Return special upon seeing a positional matcher
			if ( matcher[ expando ] ) {
				// Find the next relative operator (if any) for proper handling
				j = ++i;
				for ( ; j < len; j++ ) {
					if ( Expr.relative[ tokens[j].type ] ) {
						break;
					}
				}
				return setMatcher(
					i > 1 && elementMatcher( matchers ),
					i > 1 && toSelector(
						// If the preceding token was a descendant combinator, insert an implicit any-element `*`
						tokens.slice( 0, i - 1 ).concat({ value: tokens[ i - 2 ].type === " " ? "*" : "" })
					).replace( rtrim, "$1" ),
					matcher,
					i < j && matcherFromTokens( tokens.slice( i, j ) ),
					j < len && matcherFromTokens( (tokens = tokens.slice( j )) ),
					j < len && toSelector( tokens )
				);
			}
			matchers.push( matcher );
		}
	}

	return elementMatcher( matchers );
}

function matcherFromGroupMatchers( elementMatchers, setMatchers ) {
	var bySet = setMatchers.length > 0,
		byElement = elementMatchers.length > 0,
		superMatcher = function( seed, context, xml, results, outermost ) {
			var elem, j, matcher,
				matchedCount = 0,
				i = "0",
				unmatched = seed && [],
				setMatched = [],
				contextBackup = outermostContext,
				// We must always have either seed elements or outermost context
				elems = seed || byElement && Expr.find["TAG"]( "*", outermost ),
				// Use integer dirruns iff this is the outermost matcher
				dirrunsUnique = (dirruns += contextBackup == null ? 1 : Math.random() || 0.1),
				len = elems.length;

			if ( outermost ) {
				outermostContext = context !== document && context;
			}

			// Add elements passing elementMatchers directly to results
			// Keep `i` a string if there are no elements so `matchedCount` will be "00" below
			// Support: IE<9, Safari
			// Tolerate NodeList properties (IE: "length"; Safari: <number>) matching elements by id
			for ( ; i !== len && (elem = elems[i]) != null; i++ ) {
				if ( byElement && elem ) {
					j = 0;
					while ( (matcher = elementMatchers[j++]) ) {
						if ( matcher( elem, context, xml ) ) {
							results.push( elem );
							break;
						}
					}
					if ( outermost ) {
						dirruns = dirrunsUnique;
					}
				}

				// Track unmatched elements for set filters
				if ( bySet ) {
					// They will have gone through all possible matchers
					if ( (elem = !matcher && elem) ) {
						matchedCount--;
					}

					// Lengthen the array for every element, matched or not
					if ( seed ) {
						unmatched.push( elem );
					}
				}
			}

			// Apply set filters to unmatched elements
			matchedCount += i;
			if ( bySet && i !== matchedCount ) {
				j = 0;
				while ( (matcher = setMatchers[j++]) ) {
					matcher( unmatched, setMatched, context, xml );
				}

				if ( seed ) {
					// Reintegrate element matches to eliminate the need for sorting
					if ( matchedCount > 0 ) {
						while ( i-- ) {
							if ( !(unmatched[i] || setMatched[i]) ) {
								setMatched[i] = pop.call( results );
							}
						}
					}

					// Discard index placeholder values to get only actual matches
					setMatched = condense( setMatched );
				}

				// Add matches to results
				push.apply( results, setMatched );

				// Seedless set matches succeeding multiple successful matchers stipulate sorting
				if ( outermost && !seed && setMatched.length > 0 &&
					( matchedCount + setMatchers.length ) > 1 ) {

					Sizzle.uniqueSort( results );
				}
			}

			// Override manipulation of globals by nested matchers
			if ( outermost ) {
				dirruns = dirrunsUnique;
				outermostContext = contextBackup;
			}

			return unmatched;
		};

	return bySet ?
		markFunction( superMatcher ) :
		superMatcher;
}

compile = Sizzle.compile = function( selector, match /* Internal Use Only */ ) {
	var i,
		setMatchers = [],
		elementMatchers = [],
		cached = compilerCache[ selector + " " ];

	if ( !cached ) {
		// Generate a function of recursive functions that can be used to check each element
		if ( !match ) {
			match = tokenize( selector );
		}
		i = match.length;
		while ( i-- ) {
			cached = matcherFromTokens( match[i] );
			if ( cached[ expando ] ) {
				setMatchers.push( cached );
			} else {
				elementMatchers.push( cached );
			}
		}

		// Cache the compiled function
		cached = compilerCache( selector, matcherFromGroupMatchers( elementMatchers, setMatchers ) );

		// Save selector and tokenization
		cached.selector = selector;
	}
	return cached;
};

/**
 * A low-level selection function that works with Sizzle's compiled
 *  selector functions
 * @param {String|Function} selector A selector or a pre-compiled
 *  selector function built with Sizzle.compile
 * @param {Element} context
 * @param {Array} [results]
 * @param {Array} [seed] A set of elements to match against
 */
select = Sizzle.select = function( selector, context, results, seed ) {
	var i, tokens, token, type, find,
		compiled = typeof selector === "function" && selector,
		match = !seed && tokenize( (selector = compiled.selector || selector) );

	results = results || [];

	// Try to minimize operations if there is no seed and only one group
	if ( match.length === 1 ) {

		// Take a shortcut and set the context if the root selector is an ID
		tokens = match[0] = match[0].slice( 0 );
		if ( tokens.length > 2 && (token = tokens[0]).type === "ID" &&
				support.getById && context.nodeType === 9 && documentIsHTML &&
				Expr.relative[ tokens[1].type ] ) {

			context = ( Expr.find["ID"]( token.matches[0].replace(runescape, funescape), context ) || [] )[0];
			if ( !context ) {
				return results;

			// Precompiled matchers will still verify ancestry, so step up a level
			} else if ( compiled ) {
				context = context.parentNode;
			}

			selector = selector.slice( tokens.shift().value.length );
		}

		// Fetch a seed set for right-to-left matching
		i = matchExpr["needsContext"].test( selector ) ? 0 : tokens.length;
		while ( i-- ) {
			token = tokens[i];

			// Abort if we hit a combinator
			if ( Expr.relative[ (type = token.type) ] ) {
				break;
			}
			if ( (find = Expr.find[ type ]) ) {
				// Search, expanding context for leading sibling combinators
				if ( (seed = find(
					token.matches[0].replace( runescape, funescape ),
					rsibling.test( tokens[0].type ) && testContext( context.parentNode ) || context
				)) ) {

					// If seed is empty or no tokens remain, we can return early
					tokens.splice( i, 1 );
					selector = seed.length && toSelector( tokens );
					if ( !selector ) {
						push.apply( results, seed );
						return results;
					}

					break;
				}
			}
		}
	}

	// Compile and execute a filtering function if one is not provided
	// Provide `match` to avoid retokenization if we modified the selector above
	( compiled || compile( selector, match ) )(
		seed,
		context,
		!documentIsHTML,
		results,
		rsibling.test( selector ) && testContext( context.parentNode ) || context
	);
	return results;
};

// One-time assignments

// Sort stability
support.sortStable = expando.split("").sort( sortOrder ).join("") === expando;

// Support: Chrome 14-35+
// Always assume duplicates if they aren't passed to the comparison function
support.detectDuplicates = !!hasDuplicate;

// Initialize against the default document
setDocument();

// Support: Webkit<537.32 - Safari 6.0.3/Chrome 25 (fixed in Chrome 27)
// Detached nodes confoundingly follow *each other*
support.sortDetached = assert(function( div1 ) {
	// Should return 1, but returns 4 (following)
	return div1.compareDocumentPosition( document.createElement("div") ) & 1;
});

// Support: IE<8
// Prevent attribute/property "interpolation"
// http://msdn.microsoft.com/en-us/library/ms536429%28VS.85%29.aspx
if ( !assert(function( div ) {
	div.innerHTML = "<a href='#'></a>";
	return div.firstChild.getAttribute("href") === "#" ;
}) ) {
	addHandle( "type|href|height|width", function( elem, name, isXML ) {
		if ( !isXML ) {
			return elem.getAttribute( name, name.toLowerCase() === "type" ? 1 : 2 );
		}
	});
}

// Support: IE<9
// Use defaultValue in place of getAttribute("value")
if ( !support.attributes || !assert(function( div ) {
	div.innerHTML = "<input/>";
	div.firstChild.setAttribute( "value", "" );
	return div.firstChild.getAttribute( "value" ) === "";
}) ) {
	addHandle( "value", function( elem, name, isXML ) {
		if ( !isXML && elem.nodeName.toLowerCase() === "input" ) {
			return elem.defaultValue;
		}
	});
}

// Support: IE<9
// Use getAttributeNode to fetch booleans when getAttribute lies
if ( !assert(function( div ) {
	return div.getAttribute("disabled") == null;
}) ) {
	addHandle( booleans, function( elem, name, isXML ) {
		var val;
		if ( !isXML ) {
			return elem[ name ] === true ? name.toLowerCase() :
					(val = elem.getAttributeNode( name )) && val.specified ?
					val.value :
				null;
		}
	});
}

return Sizzle;

})( window );



jQuery.find = Sizzle;
jQuery.expr = Sizzle.selectors;
jQuery.expr[":"] = jQuery.expr.pseudos;
jQuery.unique = Sizzle.uniqueSort;
jQuery.text = Sizzle.getText;
jQuery.isXMLDoc = Sizzle.isXML;
jQuery.contains = Sizzle.contains;



var rneedsContext = jQuery.expr.match.needsContext;

var rsingleTag = (/^<(\w+)\s*\/?>(?:<\/\1>|)$/);



var risSimple = /^.[^:#\[\.,]*$/;

// Implement the identical functionality for filter and not
function winnow( elements, qualifier, not ) {
	if ( jQuery.isFunction( qualifier ) ) {
		return jQuery.grep( elements, function( elem, i ) {
			/* jshint -W018 */
			return !!qualifier.call( elem, i, elem ) !== not;
		});

	}

	if ( qualifier.nodeType ) {
		return jQuery.grep( elements, function( elem ) {
			return ( elem === qualifier ) !== not;
		});

	}

	if ( typeof qualifier === "string" ) {
		if ( risSimple.test( qualifier ) ) {
			return jQuery.filter( qualifier, elements, not );
		}

		qualifier = jQuery.filter( qualifier, elements );
	}

	return jQuery.grep( elements, function( elem ) {
		return ( jQuery.inArray( elem, qualifier ) >= 0 ) !== not;
	});
}

jQuery.filter = function( expr, elems, not ) {
	var elem = elems[ 0 ];

	if ( not ) {
		expr = ":not(" + expr + ")";
	}

	return elems.length === 1 && elem.nodeType === 1 ?
		jQuery.find.matchesSelector( elem, expr ) ? [ elem ] : [] :
		jQuery.find.matches( expr, jQuery.grep( elems, function( elem ) {
			return elem.nodeType === 1;
		}));
};

jQuery.fn.extend({
	find: function( selector ) {
		var i,
			ret = [],
			self = this,
			len = self.length;

		if ( typeof selector !== "string" ) {
			return this.pushStack( jQuery( selector ).filter(function() {
				for ( i = 0; i < len; i++ ) {
					if ( jQuery.contains( self[ i ], this ) ) {
						return true;
					}
				}
			}) );
		}

		for ( i = 0; i < len; i++ ) {
			jQuery.find( selector, self[ i ], ret );
		}

		// Needed because $( selector, context ) becomes $( context ).find( selector )
		ret = this.pushStack( len > 1 ? jQuery.unique( ret ) : ret );
		ret.selector = this.selector ? this.selector + " " + selector : selector;
		return ret;
	},
	filter: function( selector ) {
		return this.pushStack( winnow(this, selector || [], false) );
	},
	not: function( selector ) {
		return this.pushStack( winnow(this, selector || [], true) );
	},
	is: function( selector ) {
		return !!winnow(
			this,

			// If this is a positional/relative selector, check membership in the returned set
			// so $("p:first").is("p:last") won't return true for a doc with two "p".
			typeof selector === "string" && rneedsContext.test( selector ) ?
				jQuery( selector ) :
				selector || [],
			false
		).length;
	}
});


// Initialize a jQuery object


// A central reference to the root jQuery(document)
var rootjQuery,

	// Use the correct document accordingly with window argument (sandbox)
	document = window.document,

	// A simple way to check for HTML strings
	// Prioritize #id over <tag> to avoid XSS via location.hash (#9521)
	// Strict HTML recognition (#11290: must start with <)
	rquickExpr = /^(?:\s*(<[\w\W]+>)[^>]*|#([\w-]*))$/,

	init = jQuery.fn.init = function( selector, context ) {
		var match, elem;

		// HANDLE: $(""), $(null), $(undefined), $(false)
		if ( !selector ) {
			return this;
		}

		// Handle HTML strings
		if ( typeof selector === "string" ) {
			if ( selector.charAt(0) === "<" && selector.charAt( selector.length - 1 ) === ">" && selector.length >= 3 ) {
				// Assume that strings that start and end with <> are HTML and skip the regex check
				match = [ null, selector, null ];

			} else {
				match = rquickExpr.exec( selector );
			}

			// Match html or make sure no context is specified for #id
			if ( match && (match[1] || !context) ) {

				// HANDLE: $(html) -> $(array)
				if ( match[1] ) {
					context = context instanceof jQuery ? context[0] : context;

					// scripts is true for back-compat
					// Intentionally let the error be thrown if parseHTML is not present
					jQuery.merge( this, jQuery.parseHTML(
						match[1],
						context && context.nodeType ? context.ownerDocument || context : document,
						true
					) );

					// HANDLE: $(html, props)
					if ( rsingleTag.test( match[1] ) && jQuery.isPlainObject( context ) ) {
						for ( match in context ) {
							// Properties of context are called as methods if possible
							if ( jQuery.isFunction( this[ match ] ) ) {
								this[ match ]( context[ match ] );

							// ...and otherwise set as attributes
							} else {
								this.attr( match, context[ match ] );
							}
						}
					}

					return this;

				// HANDLE: $(#id)
				} else {
					elem = document.getElementById( match[2] );

					// Check parentNode to catch when Blackberry 4.6 returns
					// nodes that are no longer in the document #6963
					if ( elem && elem.parentNode ) {
						// Handle the case where IE and Opera return items
						// by name instead of ID
						if ( elem.id !== match[2] ) {
							return rootjQuery.find( selector );
						}

						// Otherwise, we inject the element directly into the jQuery object
						this.length = 1;
						this[0] = elem;
					}

					this.context = document;
					this.selector = selector;
					return this;
				}

			// HANDLE: $(expr, $(...))
			} else if ( !context || context.jquery ) {
				return ( context || rootjQuery ).find( selector );

			// HANDLE: $(expr, context)
			// (which is just equivalent to: $(context).find(expr)
			} else {
				return this.constructor( context ).find( selector );
			}

		// HANDLE: $(DOMElement)
		} else if ( selector.nodeType ) {
			this.context = this[0] = selector;
			this.length = 1;
			return this;

		// HANDLE: $(function)
		// Shortcut for document ready
		} else if ( jQuery.isFunction( selector ) ) {
			return typeof rootjQuery.ready !== "undefined" ?
				rootjQuery.ready( selector ) :
				// Execute immediately if ready is not present
				selector( jQuery );
		}

		if ( selector.selector !== undefined ) {
			this.selector = selector.selector;
			this.context = selector.context;
		}

		return jQuery.makeArray( selector, this );
	};

// Give the init function the jQuery prototype for later instantiation
init.prototype = jQuery.fn;

// Initialize central reference
rootjQuery = jQuery( document );


var rparentsprev = /^(?:parents|prev(?:Until|All))/,
	// methods guaranteed to produce a unique set when starting from a unique set
	guaranteedUnique = {
		children: true,
		contents: true,
		next: true,
		prev: true
	};

jQuery.extend({
	dir: function( elem, dir, until ) {
		var matched = [],
			cur = elem[ dir ];

		while ( cur && cur.nodeType !== 9 && (until === undefined || cur.nodeType !== 1 || !jQuery( cur ).is( until )) ) {
			if ( cur.nodeType === 1 ) {
				matched.push( cur );
			}
			cur = cur[dir];
		}
		return matched;
	},

	sibling: function( n, elem ) {
		var r = [];

		for ( ; n; n = n.nextSibling ) {
			if ( n.nodeType === 1 && n !== elem ) {
				r.push( n );
			}
		}

		return r;
	}
});

jQuery.fn.extend({
	has: function( target ) {
		var i,
			targets = jQuery( target, this ),
			len = targets.length;

		return this.filter(function() {
			for ( i = 0; i < len; i++ ) {
				if ( jQuery.contains( this, targets[i] ) ) {
					return true;
				}
			}
		});
	},

	closest: function( selectors, context ) {
		var cur,
			i = 0,
			l = this.length,
			matched = [],
			pos = rneedsContext.test( selectors ) || typeof selectors !== "string" ?
				jQuery( selectors, context || this.context ) :
				0;

		for ( ; i < l; i++ ) {
			for ( cur = this[i]; cur && cur !== context; cur = cur.parentNode ) {
				// Always skip document fragments
				if ( cur.nodeType < 11 && (pos ?
					pos.index(cur) > -1 :

					// Don't pass non-elements to Sizzle
					cur.nodeType === 1 &&
						jQuery.find.matchesSelector(cur, selectors)) ) {

					matched.push( cur );
					break;
				}
			}
		}

		return this.pushStack( matched.length > 1 ? jQuery.unique( matched ) : matched );
	},

	// Determine the position of an element within
	// the matched set of elements
	index: function( elem ) {

		// No argument, return index in parent
		if ( !elem ) {
			return ( this[0] && this[0].parentNode ) ? this.first().prevAll().length : -1;
		}

		// index in selector
		if ( typeof elem === "string" ) {
			return jQuery.inArray( this[0], jQuery( elem ) );
		}

		// Locate the position of the desired element
		return jQuery.inArray(
			// If it receives a jQuery object, the first element is used
			elem.jquery ? elem[0] : elem, this );
	},

	add: function( selector, context ) {
		return this.pushStack(
			jQuery.unique(
				jQuery.merge( this.get(), jQuery( selector, context ) )
			)
		);
	},

	addBack: function( selector ) {
		return this.add( selector == null ?
			this.prevObject : this.prevObject.filter(selector)
		);
	}
});

function sibling( cur, dir ) {
	do {
		cur = cur[ dir ];
	} while ( cur && cur.nodeType !== 1 );

	return cur;
}

jQuery.each({
	parent: function( elem ) {
		var parent = elem.parentNode;
		return parent && parent.nodeType !== 11 ? parent : null;
	},
	parents: function( elem ) {
		return jQuery.dir( elem, "parentNode" );
	},
	parentsUntil: function( elem, i, until ) {
		return jQuery.dir( elem, "parentNode", until );
	},
	next: function( elem ) {
		return sibling( elem, "nextSibling" );
	},
	prev: function( elem ) {
		return sibling( elem, "previousSibling" );
	},
	nextAll: function( elem ) {
		return jQuery.dir( elem, "nextSibling" );
	},
	prevAll: function( elem ) {
		return jQuery.dir( elem, "previousSibling" );
	},
	nextUntil: function( elem, i, until ) {
		return jQuery.dir( elem, "nextSibling", until );
	},
	prevUntil: function( elem, i, until ) {
		return jQuery.dir( elem, "previousSibling", until );
	},
	siblings: function( elem ) {
		return jQuery.sibling( ( elem.parentNode || {} ).firstChild, elem );
	},
	children: function( elem ) {
		return jQuery.sibling( elem.firstChild );
	},
	contents: function( elem ) {
		return jQuery.nodeName( elem, "iframe" ) ?
			elem.contentDocument || elem.contentWindow.document :
			jQuery.merge( [], elem.childNodes );
	}
}, function( name, fn ) {
	jQuery.fn[ name ] = function( until, selector ) {
		var ret = jQuery.map( this, fn, until );

		if ( name.slice( -5 ) !== "Until" ) {
			selector = until;
		}

		if ( selector && typeof selector === "string" ) {
			ret = jQuery.filter( selector, ret );
		}

		if ( this.length > 1 ) {
			// Remove duplicates
			if ( !guaranteedUnique[ name ] ) {
				ret = jQuery.unique( ret );
			}

			// Reverse order for parents* and prev-derivatives
			if ( rparentsprev.test( name ) ) {
				ret = ret.reverse();
			}
		}

		return this.pushStack( ret );
	};
});
var rnotwhite = (/\S+/g);



// String to Object options format cache
var optionsCache = {};

// Convert String-formatted options into Object-formatted ones and store in cache
function createOptions( options ) {
	var object = optionsCache[ options ] = {};
	jQuery.each( options.match( rnotwhite ) || [], function( _, flag ) {
		object[ flag ] = true;
	});
	return object;
}

/*
 * Create a callback list using the following parameters:
 *
 *	options: an optional list of space-separated options that will change how
 *			the callback list behaves or a more traditional option object
 *
 * By default a callback list will act like an event callback list and can be
 * "fired" multiple times.
 *
 * Possible options:
 *
 *	once:			will ensure the callback list can only be fired once (like a Deferred)
 *
 *	memory:			will keep track of previous values and will call any callback added
 *					after the list has been fired right away with the latest "memorized"
 *					values (like a Deferred)
 *
 *	unique:			will ensure a callback can only be added once (no duplicate in the list)
 *
 *	stopOnFalse:	interrupt callings when a callback returns false
 *
 */
jQuery.Callbacks = function( options ) {

	// Convert options from String-formatted to Object-formatted if needed
	// (we check in cache first)
	options = typeof options === "string" ?
		( optionsCache[ options ] || createOptions( options ) ) :
		jQuery.extend( {}, options );

	var // Flag to know if list is currently firing
		firing,
		// Last fire value (for non-forgettable lists)
		memory,
		// Flag to know if list was already fired
		fired,
		// End of the loop when firing
		firingLength,
		// Index of currently firing callback (modified by remove if needed)
		firingIndex,
		// First callback to fire (used internally by add and fireWith)
		firingStart,
		// Actual callback list
		list = [],
		// Stack of fire calls for repeatable lists
		stack = !options.once && [],
		// Fire callbacks
		fire = function( data ) {
			memory = options.memory && data;
			fired = true;
			firingIndex = firingStart || 0;
			firingStart = 0;
			firingLength = list.length;
			firing = true;
			for ( ; list && firingIndex < firingLength; firingIndex++ ) {
				if ( list[ firingIndex ].apply( data[ 0 ], data[ 1 ] ) === false && options.stopOnFalse ) {
					memory = false; // To prevent further calls using add
					break;
				}
			}
			firing = false;
			if ( list ) {
				if ( stack ) {
					if ( stack.length ) {
						fire( stack.shift() );
					}
				} else if ( memory ) {
					list = [];
				} else {
					self.disable();
				}
			}
		},
		// Actual Callbacks object
		self = {
			// Add a callback or a collection of callbacks to the list
			add: function() {
				if ( list ) {
					// First, we save the current length
					var start = list.length;
					(function add( args ) {
						jQuery.each( args, function( _, arg ) {
							var type = jQuery.type( arg );
							if ( type === "function" ) {
								if ( !options.unique || !self.has( arg ) ) {
									list.push( arg );
								}
							} else if ( arg && arg.length && type !== "string" ) {
								// Inspect recursively
								add( arg );
							}
						});
					})( arguments );
					// Do we need to add the callbacks to the
					// current firing batch?
					if ( firing ) {
						firingLength = list.length;
					// With memory, if we're not firing then
					// we should call right away
					} else if ( memory ) {
						firingStart = start;
						fire( memory );
					}
				}
				return this;
			},
			// Remove a callback from the list
			remove: function() {
				if ( list ) {
					jQuery.each( arguments, function( _, arg ) {
						var index;
						while ( ( index = jQuery.inArray( arg, list, index ) ) > -1 ) {
							list.splice( index, 1 );
							// Handle firing indexes
							if ( firing ) {
								if ( index <= firingLength ) {
									firingLength--;
								}
								if ( index <= firingIndex ) {
									firingIndex--;
								}
							}
						}
					});
				}
				return this;
			},
			// Check if a given callback is in the list.
			// If no argument is given, return whether or not list has callbacks attached.
			has: function( fn ) {
				return fn ? jQuery.inArray( fn, list ) > -1 : !!( list && list.length );
			},
			// Remove all callbacks from the list
			empty: function() {
				list = [];
				firingLength = 0;
				return this;
			},
			// Have the list do nothing anymore
			disable: function() {
				list = stack = memory = undefined;
				return this;
			},
			// Is it disabled?
			disabled: function() {
				return !list;
			},
			// Lock the list in its current state
			lock: function() {
				stack = undefined;
				if ( !memory ) {
					self.disable();
				}
				return this;
			},
			// Is it locked?
			locked: function() {
				return !stack;
			},
			// Call all callbacks with the given context and arguments
			fireWith: function( context, args ) {
				if ( list && ( !fired || stack ) ) {
					args = args || [];
					args = [ context, args.slice ? args.slice() : args ];
					if ( firing ) {
						stack.push( args );
					} else {
						fire( args );
					}
				}
				return this;
			},
			// Call all the callbacks with the given arguments
			fire: function() {
				self.fireWith( this, arguments );
				return this;
			},
			// To know if the callbacks have already been called at least once
			fired: function() {
				return !!fired;
			}
		};

	return self;
};


jQuery.extend({

	Deferred: function( func ) {
		var tuples = [
				// action, add listener, listener list, final state
				[ "resolve", "done", jQuery.Callbacks("once memory"), "resolved" ],
				[ "reject", "fail", jQuery.Callbacks("once memory"), "rejected" ],
				[ "notify", "progress", jQuery.Callbacks("memory") ]
			],
			state = "pending",
			promise = {
				state: function() {
					return state;
				},
				always: function() {
					deferred.done( arguments ).fail( arguments );
					return this;
				},
				then: function( /* fnDone, fnFail, fnProgress */ ) {
					var fns = arguments;
					return jQuery.Deferred(function( newDefer ) {
						jQuery.each( tuples, function( i, tuple ) {
							var fn = jQuery.isFunction( fns[ i ] ) && fns[ i ];
							// deferred[ done | fail | progress ] for forwarding actions to newDefer
							deferred[ tuple[1] ](function() {
								var returned = fn && fn.apply( this, arguments );
								if ( returned && jQuery.isFunction( returned.promise ) ) {
									returned.promise()
										.done( newDefer.resolve )
										.fail( newDefer.reject )
										.progress( newDefer.notify );
								} else {
									newDefer[ tuple[ 0 ] + "With" ]( this === promise ? newDefer.promise() : this, fn ? [ returned ] : arguments );
								}
							});
						});
						fns = null;
					}).promise();
				},
				// Get a promise for this deferred
				// If obj is provided, the promise aspect is added to the object
				promise: function( obj ) {
					return obj != null ? jQuery.extend( obj, promise ) : promise;
				}
			},
			deferred = {};

		// Keep pipe for back-compat
		promise.pipe = promise.then;

		// Add list-specific methods
		jQuery.each( tuples, function( i, tuple ) {
			var list = tuple[ 2 ],
				stateString = tuple[ 3 ];

			// promise[ done | fail | progress ] = list.add
			promise[ tuple[1] ] = list.add;

			// Handle state
			if ( stateString ) {
				list.add(function() {
					// state = [ resolved | rejected ]
					state = stateString;

				// [ reject_list | resolve_list ].disable; progress_list.lock
				}, tuples[ i ^ 1 ][ 2 ].disable, tuples[ 2 ][ 2 ].lock );
			}

			// deferred[ resolve | reject | notify ]
			deferred[ tuple[0] ] = function() {
				deferred[ tuple[0] + "With" ]( this === deferred ? promise : this, arguments );
				return this;
			};
			deferred[ tuple[0] + "With" ] = list.fireWith;
		});

		// Make the deferred a promise
		promise.promise( deferred );

		// Call given func if any
		if ( func ) {
			func.call( deferred, deferred );
		}

		// All done!
		return deferred;
	},

	// Deferred helper
	when: function( subordinate /* , ..., subordinateN */ ) {
		var i = 0,
			resolveValues = slice.call( arguments ),
			length = resolveValues.length,

			// the count of uncompleted subordinates
			remaining = length !== 1 || ( subordinate && jQuery.isFunction( subordinate.promise ) ) ? length : 0,

			// the master Deferred. If resolveValues consist of only a single Deferred, just use that.
			deferred = remaining === 1 ? subordinate : jQuery.Deferred(),

			// Update function for both resolve and progress values
			updateFunc = function( i, contexts, values ) {
				return function( value ) {
					contexts[ i ] = this;
					values[ i ] = arguments.length > 1 ? slice.call( arguments ) : value;
					if ( values === progressValues ) {
						deferred.notifyWith( contexts, values );

					} else if ( !(--remaining) ) {
						deferred.resolveWith( contexts, values );
					}
				};
			},

			progressValues, progressContexts, resolveContexts;

		// add listeners to Deferred subordinates; treat others as resolved
		if ( length > 1 ) {
			progressValues = new Array( length );
			progressContexts = new Array( length );
			resolveContexts = new Array( length );
			for ( ; i < length; i++ ) {
				if ( resolveValues[ i ] && jQuery.isFunction( resolveValues[ i ].promise ) ) {
					resolveValues[ i ].promise()
						.done( updateFunc( i, resolveContexts, resolveValues ) )
						.fail( deferred.reject )
						.progress( updateFunc( i, progressContexts, progressValues ) );
				} else {
					--remaining;
				}
			}
		}

		// if we're not waiting on anything, resolve the master
		if ( !remaining ) {
			deferred.resolveWith( resolveContexts, resolveValues );
		}

		return deferred.promise();
	}
});


// The deferred used on DOM ready
var readyList;

jQuery.fn.ready = function( fn ) {
	// Add the callback
	jQuery.ready.promise().done( fn );

	return this;
};

jQuery.extend({
	// Is the DOM ready to be used? Set to true once it occurs.
	isReady: false,

	// A counter to track how many items to wait for before
	// the ready event fires. See #6781
	readyWait: 1,

	// Hold (or release) the ready event
	holdReady: function( hold ) {
		if ( hold ) {
			jQuery.readyWait++;
		} else {
			jQuery.ready( true );
		}
	},

	// Handle when the DOM is ready
	ready: function( wait ) {

		// Abort if there are pending holds or we're already ready
		if ( wait === true ? --jQuery.readyWait : jQuery.isReady ) {
			return;
		}

		// Make sure body exists, at least, in case IE gets a little overzealous (ticket #5443).
		if ( !document.body ) {
			return setTimeout( jQuery.ready );
		}

		// Remember that the DOM is ready
		jQuery.isReady = true;

		// If a normal DOM Ready event fired, decrement, and wait if need be
		if ( wait !== true && --jQuery.readyWait > 0 ) {
			return;
		}

		// If there are functions bound, to execute
		readyList.resolveWith( document, [ jQuery ] );

		// Trigger any bound ready events
		if ( jQuery.fn.triggerHandler ) {
			jQuery( document ).triggerHandler( "ready" );
			jQuery( document ).off( "ready" );
		}
	}
});

/**
 * Clean-up method for dom ready events
 */
function detach() {
	if ( document.addEventListener ) {
		document.removeEventListener( "DOMContentLoaded", completed, false );
		window.removeEventListener( "load", completed, false );

	} else {
		document.detachEvent( "onreadystatechange", completed );
		window.detachEvent( "onload", completed );
	}
}

/**
 * The ready event handler and self cleanup method
 */
function completed() {
	// readyState === "complete" is good enough for us to call the dom ready in oldIE
	if ( document.addEventListener || event.type === "load" || document.readyState === "complete" ) {
		detach();
		jQuery.ready();
	}
}

jQuery.ready.promise = function( obj ) {
	if ( !readyList ) {

		readyList = jQuery.Deferred();

		// Catch cases where $(document).ready() is called after the browser event has already occurred.
		// we once tried to use readyState "interactive" here, but it caused issues like the one
		// discovered by ChrisS here: http://bugs.jquery.com/ticket/12282#comment:15
		if ( document.readyState === "complete" ) {
			// Handle it asynchronously to allow scripts the opportunity to delay ready
			setTimeout( jQuery.ready );

		// Standards-based browsers support DOMContentLoaded
		} else if ( document.addEventListener ) {
			// Use the handy event callback
			document.addEventListener( "DOMContentLoaded", completed, false );

			// A fallback to window.onload, that will always work
			window.addEventListener( "load", completed, false );

		// If IE event model is used
		} else {
			// Ensure firing before onload, maybe late but safe also for iframes
			document.attachEvent( "onreadystatechange", completed );

			// A fallback to window.onload, that will always work
			window.attachEvent( "onload", completed );

			// If IE and not a frame
			// continually check to see if the document is ready
			var top = false;

			try {
				top = window.frameElement == null && document.documentElement;
			} catch(e) {}

			if ( top && top.doScroll ) {
				(function doScrollCheck() {
					if ( !jQuery.isReady ) {

						try {
							// Use the trick by Diego Perini
							// http://javascript.nwbox.com/IEContentLoaded/
							top.doScroll("left");
						} catch(e) {
							return setTimeout( doScrollCheck, 50 );
						}

						// detach all dom ready events
						detach();

						// and execute any waiting functions
						jQuery.ready();
					}
				})();
			}
		}
	}
	return readyList.promise( obj );
};


var strundefined = typeof undefined;



// Support: IE<9
// Iteration over object's inherited properties before its own
var i;
for ( i in jQuery( support ) ) {
	break;
}
support.ownLast = i !== "0";

// Note: most support tests are defined in their respective modules.
// false until the test is run
support.inlineBlockNeedsLayout = false;

// Execute ASAP in case we need to set body.style.zoom
jQuery(function() {
	// Minified: var a,b,c,d
	var val, div, body, container;

	body = document.getElementsByTagName( "body" )[ 0 ];
	if ( !body || !body.style ) {
		// Return for frameset docs that don't have a body
		return;
	}

	// Setup
	div = document.createElement( "div" );
	container = document.createElement( "div" );
	container.style.cssText = "position:absolute;border:0;width:0;height:0;top:0;left:-9999px";
	body.appendChild( container ).appendChild( div );

	if ( typeof div.style.zoom !== strundefined ) {
		// Support: IE<8
		// Check if natively block-level elements act like inline-block
		// elements when setting their display to 'inline' and giving
		// them layout
		div.style.cssText = "display:inline;margin:0;border:0;padding:1px;width:1px;zoom:1";

		support.inlineBlockNeedsLayout = val = div.offsetWidth === 3;
		if ( val ) {
			// Prevent IE 6 from affecting layout for positioned elements #11048
			// Prevent IE from shrinking the body in IE 7 mode #12869
			// Support: IE<8
			body.style.zoom = 1;
		}
	}

	body.removeChild( container );
});




(function() {
	var div = document.createElement( "div" );

	// Execute the test only if not already executed in another module.
	if (support.deleteExpando == null) {
		// Support: IE<9
		support.deleteExpando = true;
		try {
			delete div.test;
		} catch( e ) {
			support.deleteExpando = false;
		}
	}

	// Null elements to avoid leaks in IE.
	div = null;
})();


/**
 * Determines whether an object can have data
 */
jQuery.acceptData = function( elem ) {
	var noData = jQuery.noData[ (elem.nodeName + " ").toLowerCase() ],
		nodeType = +elem.nodeType || 1;

	// Do not set data on non-element DOM nodes because it will not be cleared (#8335).
	return nodeType !== 1 && nodeType !== 9 ?
		false :

		// Nodes accept data unless otherwise specified; rejection can be conditional
		!noData || noData !== true && elem.getAttribute("classid") === noData;
};


var rbrace = /^(?:\{[\w\W]*\}|\[[\w\W]*\])$/,
	rmultiDash = /([A-Z])/g;

function dataAttr( elem, key, data ) {
	// If nothing was found internally, try to fetch any
	// data from the HTML5 data-* attribute
	if ( data === undefined && elem.nodeType === 1 ) {

		var name = "data-" + key.replace( rmultiDash, "-$1" ).toLowerCase();

		data = elem.getAttribute( name );

		if ( typeof data === "string" ) {
			try {
				data = data === "true" ? true :
					data === "false" ? false :
					data === "null" ? null :
					// Only convert to a number if it doesn't change the string
					+data + "" === data ? +data :
					rbrace.test( data ) ? jQuery.parseJSON( data ) :
					data;
			} catch( e ) {}

			// Make sure we set the data so it isn't changed later
			jQuery.data( elem, key, data );

		} else {
			data = undefined;
		}
	}

	return data;
}

// checks a cache object for emptiness
function isEmptyDataObject( obj ) {
	var name;
	for ( name in obj ) {

		// if the public data object is empty, the private is still empty
		if ( name === "data" && jQuery.isEmptyObject( obj[name] ) ) {
			continue;
		}
		if ( name !== "toJSON" ) {
			return false;
		}
	}

	return true;
}

function internalData( elem, name, data, pvt /* Internal Use Only */ ) {
	if ( !jQuery.acceptData( elem ) ) {
		return;
	}

	var ret, thisCache,
		internalKey = jQuery.expando,

		// We have to handle DOM nodes and JS objects differently because IE6-7
		// can't GC object references properly across the DOM-JS boundary
		isNode = elem.nodeType,

		// Only DOM nodes need the global jQuery cache; JS object data is
		// attached directly to the object so GC can occur automatically
		cache = isNode ? jQuery.cache : elem,

		// Only defining an ID for JS objects if its cache already exists allows
		// the code to shortcut on the same path as a DOM node with no cache
		id = isNode ? elem[ internalKey ] : elem[ internalKey ] && internalKey;

	// Avoid doing any more work than we need to when trying to get data on an
	// object that has no data at all
	if ( (!id || !cache[id] || (!pvt && !cache[id].data)) && data === undefined && typeof name === "string" ) {
		return;
	}

	if ( !id ) {
		// Only DOM nodes need a new unique ID for each element since their data
		// ends up in the global cache
		if ( isNode ) {
			id = elem[ internalKey ] = deletedIds.pop() || jQuery.guid++;
		} else {
			id = internalKey;
		}
	}

	if ( !cache[ id ] ) {
		// Avoid exposing jQuery metadata on plain JS objects when the object
		// is serialized using JSON.stringify
		cache[ id ] = isNode ? {} : { toJSON: jQuery.noop };
	}

	// An object can be passed to jQuery.data instead of a key/value pair; this gets
	// shallow copied over onto the existing cache
	if ( typeof name === "object" || typeof name === "function" ) {
		if ( pvt ) {
			cache[ id ] = jQuery.extend( cache[ id ], name );
		} else {
			cache[ id ].data = jQuery.extend( cache[ id ].data, name );
		}
	}

	thisCache = cache[ id ];

	// jQuery data() is stored in a separate object inside the object's internal data
	// cache in order to avoid key collisions between internal data and user-defined
	// data.
	if ( !pvt ) {
		if ( !thisCache.data ) {
			thisCache.data = {};
		}

		thisCache = thisCache.data;
	}

	if ( data !== undefined ) {
		thisCache[ jQuery.camelCase( name ) ] = data;
	}

	// Check for both converted-to-camel and non-converted data property names
	// If a data property was specified
	if ( typeof name === "string" ) {

		// First Try to find as-is property data
		ret = thisCache[ name ];

		// Test for null|undefined property data
		if ( ret == null ) {

			// Try to find the camelCased property
			ret = thisCache[ jQuery.camelCase( name ) ];
		}
	} else {
		ret = thisCache;
	}

	return ret;
}

function internalRemoveData( elem, name, pvt ) {
	if ( !jQuery.acceptData( elem ) ) {
		return;
	}

	var thisCache, i,
		isNode = elem.nodeType,

		// See jQuery.data for more information
		cache = isNode ? jQuery.cache : elem,
		id = isNode ? elem[ jQuery.expando ] : jQuery.expando;

	// If there is already no cache entry for this object, there is no
	// purpose in continuing
	if ( !cache[ id ] ) {
		return;
	}

	if ( name ) {

		thisCache = pvt ? cache[ id ] : cache[ id ].data;

		if ( thisCache ) {

			// Support array or space separated string names for data keys
			if ( !jQuery.isArray( name ) ) {

				// try the string as a key before any manipulation
				if ( name in thisCache ) {
					name = [ name ];
				} else {

					// split the camel cased version by spaces unless a key with the spaces exists
					name = jQuery.camelCase( name );
					if ( name in thisCache ) {
						name = [ name ];
					} else {
						name = name.split(" ");
					}
				}
			} else {
				// If "name" is an array of keys...
				// When data is initially created, via ("key", "val") signature,
				// keys will be converted to camelCase.
				// Since there is no way to tell _how_ a key was added, remove
				// both plain key and camelCase key. #12786
				// This will only penalize the array argument path.
				name = name.concat( jQuery.map( name, jQuery.camelCase ) );
			}

			i = name.length;
			while ( i-- ) {
				delete thisCache[ name[i] ];
			}

			// If there is no data left in the cache, we want to continue
			// and let the cache object itself get destroyed
			if ( pvt ? !isEmptyDataObject(thisCache) : !jQuery.isEmptyObject(thisCache) ) {
				return;
			}
		}
	}

	// See jQuery.data for more information
	if ( !pvt ) {
		delete cache[ id ].data;

		// Don't destroy the parent cache unless the internal data object
		// had been the only thing left in it
		if ( !isEmptyDataObject( cache[ id ] ) ) {
			return;
		}
	}

	// Destroy the cache
	if ( isNode ) {
		jQuery.cleanData( [ elem ], true );

	// Use delete when supported for expandos or `cache` is not a window per isWindow (#10080)
	/* jshint eqeqeq: false */
	} else if ( support.deleteExpando || cache != cache.window ) {
		/* jshint eqeqeq: true */
		delete cache[ id ];

	// When all else fails, null
	} else {
		cache[ id ] = null;
	}
}

jQuery.extend({
	cache: {},

	// The following elements (space-suffixed to avoid Object.prototype collisions)
	// throw uncatchable exceptions if you attempt to set expando properties
	noData: {
		"applet ": true,
		"embed ": true,
		// ...but Flash objects (which have this classid) *can* handle expandos
		"object ": "clsid:D27CDB6E-AE6D-11cf-96B8-444553540000"
	},

	hasData: function( elem ) {
		elem = elem.nodeType ? jQuery.cache[ elem[jQuery.expando] ] : elem[ jQuery.expando ];
		return !!elem && !isEmptyDataObject( elem );
	},

	data: function( elem, name, data ) {
		return internalData( elem, name, data );
	},

	removeData: function( elem, name ) {
		return internalRemoveData( elem, name );
	},

	// For internal use only.
	_data: function( elem, name, data ) {
		return internalData( elem, name, data, true );
	},

	_removeData: function( elem, name ) {
		return internalRemoveData( elem, name, true );
	}
});

jQuery.fn.extend({
	data: function( key, value ) {
		var i, name, data,
			elem = this[0],
			attrs = elem && elem.attributes;

		// Special expections of .data basically thwart jQuery.access,
		// so implement the relevant behavior ourselves

		// Gets all values
		if ( key === undefined ) {
			if ( this.length ) {
				data = jQuery.data( elem );

				if ( elem.nodeType === 1 && !jQuery._data( elem, "parsedAttrs" ) ) {
					i = attrs.length;
					while ( i-- ) {

						// Support: IE11+
						// The attrs elements can be null (#14894)
						if ( attrs[ i ] ) {
							name = attrs[ i ].name;
							if ( name.indexOf( "data-" ) === 0 ) {
								name = jQuery.camelCase( name.slice(5) );
								dataAttr( elem, name, data[ name ] );
							}
						}
					}
					jQuery._data( elem, "parsedAttrs", true );
				}
			}

			return data;
		}

		// Sets multiple values
		if ( typeof key === "object" ) {
			return this.each(function() {
				jQuery.data( this, key );
			});
		}

		return arguments.length > 1 ?

			// Sets one value
			this.each(function() {
				jQuery.data( this, key, value );
			}) :

			// Gets one value
			// Try to fetch any internally stored data first
			elem ? dataAttr( elem, key, jQuery.data( elem, key ) ) : undefined;
	},

	removeData: function( key ) {
		return this.each(function() {
			jQuery.removeData( this, key );
		});
	}
});


jQuery.extend({
	queue: function( elem, type, data ) {
		var queue;

		if ( elem ) {
			type = ( type || "fx" ) + "queue";
			queue = jQuery._data( elem, type );

			// Speed up dequeue by getting out quickly if this is just a lookup
			if ( data ) {
				if ( !queue || jQuery.isArray(data) ) {
					queue = jQuery._data( elem, type, jQuery.makeArray(data) );
				} else {
					queue.push( data );
				}
			}
			return queue || [];
		}
	},

	dequeue: function( elem, type ) {
		type = type || "fx";

		var queue = jQuery.queue( elem, type ),
			startLength = queue.length,
			fn = queue.shift(),
			hooks = jQuery._queueHooks( elem, type ),
			next = function() {
				jQuery.dequeue( elem, type );
			};

		// If the fx queue is dequeued, always remove the progress sentinel
		if ( fn === "inprogress" ) {
			fn = queue.shift();
			startLength--;
		}

		if ( fn ) {

			// Add a progress sentinel to prevent the fx queue from being
			// automatically dequeued
			if ( type === "fx" ) {
				queue.unshift( "inprogress" );
			}

			// clear up the last queue stop function
			delete hooks.stop;
			fn.call( elem, next, hooks );
		}

		if ( !startLength && hooks ) {
			hooks.empty.fire();
		}
	},

	// not intended for public consumption - generates a queueHooks object, or returns the current one
	_queueHooks: function( elem, type ) {
		var key = type + "queueHooks";
		return jQuery._data( elem, key ) || jQuery._data( elem, key, {
			empty: jQuery.Callbacks("once memory").add(function() {
				jQuery._removeData( elem, type + "queue" );
				jQuery._removeData( elem, key );
			})
		});
	}
});

jQuery.fn.extend({
	queue: function( type, data ) {
		var setter = 2;

		if ( typeof type !== "string" ) {
			data = type;
			type = "fx";
			setter--;
		}

		if ( arguments.length < setter ) {
			return jQuery.queue( this[0], type );
		}

		return data === undefined ?
			this :
			this.each(function() {
				var queue = jQuery.queue( this, type, data );

				// ensure a hooks for this queue
				jQuery._queueHooks( this, type );

				if ( type === "fx" && queue[0] !== "inprogress" ) {
					jQuery.dequeue( this, type );
				}
			});
	},
	dequeue: function( type ) {
		return this.each(function() {
			jQuery.dequeue( this, type );
		});
	},
	clearQueue: function( type ) {
		return this.queue( type || "fx", [] );
	},
	// Get a promise resolved when queues of a certain type
	// are emptied (fx is the type by default)
	promise: function( type, obj ) {
		var tmp,
			count = 1,
			defer = jQuery.Deferred(),
			elements = this,
			i = this.length,
			resolve = function() {
				if ( !( --count ) ) {
					defer.resolveWith( elements, [ elements ] );
				}
			};

		if ( typeof type !== "string" ) {
			obj = type;
			type = undefined;
		}
		type = type || "fx";

		while ( i-- ) {
			tmp = jQuery._data( elements[ i ], type + "queueHooks" );
			if ( tmp && tmp.empty ) {
				count++;
				tmp.empty.add( resolve );
			}
		}
		resolve();
		return defer.promise( obj );
	}
});
var pnum = (/[+-]?(?:\d*\.|)\d+(?:[eE][+-]?\d+|)/).source;

var cssExpand = [ "Top", "Right", "Bottom", "Left" ];

var isHidden = function( elem, el ) {
		// isHidden might be called from jQuery#filter function;
		// in that case, element will be second argument
		elem = el || elem;
		return jQuery.css( elem, "display" ) === "none" || !jQuery.contains( elem.ownerDocument, elem );
	};



// Multifunctional method to get and set values of a collection
// The value/s can optionally be executed if it's a function
var access = jQuery.access = function( elems, fn, key, value, chainable, emptyGet, raw ) {
	var i = 0,
		length = elems.length,
		bulk = key == null;

	// Sets many values
	if ( jQuery.type( key ) === "object" ) {
		chainable = true;
		for ( i in key ) {
			jQuery.access( elems, fn, i, key[i], true, emptyGet, raw );
		}

	// Sets one value
	} else if ( value !== undefined ) {
		chainable = true;

		if ( !jQuery.isFunction( value ) ) {
			raw = true;
		}

		if ( bulk ) {
			// Bulk operations run against the entire set
			if ( raw ) {
				fn.call( elems, value );
				fn = null;

			// ...except when executing function values
			} else {
				bulk = fn;
				fn = function( elem, key, value ) {
					return bulk.call( jQuery( elem ), value );
				};
			}
		}

		if ( fn ) {
			for ( ; i < length; i++ ) {
				fn( elems[i], key, raw ? value : value.call( elems[i], i, fn( elems[i], key ) ) );
			}
		}
	}

	return chainable ?
		elems :

		// Gets
		bulk ?
			fn.call( elems ) :
			length ? fn( elems[0], key ) : emptyGet;
};
var rcheckableType = (/^(?:checkbox|radio)$/i);



(function() {
	// Minified: var a,b,c
	var input = document.createElement( "input" ),
		div = document.createElement( "div" ),
		fragment = document.createDocumentFragment();

	// Setup
	div.innerHTML = "  <link/><table></table><a href='/a'>a</a><input type='checkbox'/>";

	// IE strips leading whitespace when .innerHTML is used
	support.leadingWhitespace = div.firstChild.nodeType === 3;

	// Make sure that tbody elements aren't automatically inserted
	// IE will insert them into empty tables
	support.tbody = !div.getElementsByTagName( "tbody" ).length;

	// Make sure that link elements get serialized correctly by innerHTML
	// This requires a wrapper element in IE
	support.htmlSerialize = !!div.getElementsByTagName( "link" ).length;

	// Makes sure cloning an html5 element does not cause problems
	// Where outerHTML is undefined, this still works
	support.html5Clone =
		document.createElement( "nav" ).cloneNode( true ).outerHTML !== "<:nav></:nav>";

	// Check if a disconnected checkbox will retain its checked
	// value of true after appended to the DOM (IE6/7)
	input.type = "checkbox";
	input.checked = true;
	fragment.appendChild( input );
	support.appendChecked = input.checked;

	// Make sure textarea (and checkbox) defaultValue is properly cloned
	// Support: IE6-IE11+
	div.innerHTML = "<textarea>x</textarea>";
	support.noCloneChecked = !!div.cloneNode( true ).lastChild.defaultValue;

	// #11217 - WebKit loses check when the name is after the checked attribute
	fragment.appendChild( div );
	div.innerHTML = "<input type='radio' checked='checked' name='t'/>";

	// Support: Safari 5.1, iOS 5.1, Android 4.x, Android 2.3
	// old WebKit doesn't clone checked state correctly in fragments
	support.checkClone = div.cloneNode( true ).cloneNode( true ).lastChild.checked;

	// Support: IE<9
	// Opera does not clone events (and typeof div.attachEvent === undefined).
	// IE9-10 clones events bound via attachEvent, but they don't trigger with .click()
	support.noCloneEvent = true;
	if ( div.attachEvent ) {
		div.attachEvent( "onclick", function() {
			support.noCloneEvent = false;
		});

		div.cloneNode( true ).click();
	}

	// Execute the test only if not already executed in another module.
	if (support.deleteExpando == null) {
		// Support: IE<9
		support.deleteExpando = true;
		try {
			delete div.test;
		} catch( e ) {
			support.deleteExpando = false;
		}
	}
})();


(function() {
	var i, eventName,
		div = document.createElement( "div" );

	// Support: IE<9 (lack submit/change bubble), Firefox 23+ (lack focusin event)
	for ( i in { submit: true, change: true, focusin: true }) {
		eventName = "on" + i;

		if ( !(support[ i + "Bubbles" ] = eventName in window) ) {
			// Beware of CSP restrictions (https://developer.mozilla.org/en/Security/CSP)
			div.setAttribute( eventName, "t" );
			support[ i + "Bubbles" ] = div.attributes[ eventName ].expando === false;
		}
	}

	// Null elements to avoid leaks in IE.
	div = null;
})();


var rformElems = /^(?:input|select|textarea)$/i,
	rkeyEvent = /^key/,
	rmouseEvent = /^(?:mouse|pointer|contextmenu)|click/,
	rfocusMorph = /^(?:focusinfocus|focusoutblur)$/,
	rtypenamespace = /^([^.]*)(?:\.(.+)|)$/;

function returnTrue() {
	return true;
}

function returnFalse() {
	return false;
}

function safeActiveElement() {
	try {
		return document.activeElement;
	} catch ( err ) { }
}

/*
 * Helper functions for managing events -- not part of the public interface.
 * Props to Dean Edwards' addEvent library for many of the ideas.
 */
jQuery.event = {

	global: {},

	add: function( elem, types, handler, data, selector ) {
		var tmp, events, t, handleObjIn,
			special, eventHandle, handleObj,
			handlers, type, namespaces, origType,
			elemData = jQuery._data( elem );

		// Don't attach events to noData or text/comment nodes (but allow plain objects)
		if ( !elemData ) {
			return;
		}

		// Caller can pass in an object of custom data in lieu of the handler
		if ( handler.handler ) {
			handleObjIn = handler;
			handler = handleObjIn.handler;
			selector = handleObjIn.selector;
		}

		// Make sure that the handler has a unique ID, used to find/remove it later
		if ( !handler.guid ) {
			handler.guid = jQuery.guid++;
		}

		// Init the element's event structure and main handler, if this is the first
		if ( !(events = elemData.events) ) {
			events = elemData.events = {};
		}
		if ( !(eventHandle = elemData.handle) ) {
			eventHandle = elemData.handle = function( e ) {
				// Discard the second event of a jQuery.event.trigger() and
				// when an event is called after a page has unloaded
				return typeof jQuery !== strundefined && (!e || jQuery.event.triggered !== e.type) ?
					jQuery.event.dispatch.apply( eventHandle.elem, arguments ) :
					undefined;
			};
			// Add elem as a property of the handle fn to prevent a memory leak with IE non-native events
			eventHandle.elem = elem;
		}

		// Handle multiple events separated by a space
		types = ( types || "" ).match( rnotwhite ) || [ "" ];
		t = types.length;
		while ( t-- ) {
			tmp = rtypenamespace.exec( types[t] ) || [];
			type = origType = tmp[1];
			namespaces = ( tmp[2] || "" ).split( "." ).sort();

			// There *must* be a type, no attaching namespace-only handlers
			if ( !type ) {
				continue;
			}

			// If event changes its type, use the special event handlers for the changed type
			special = jQuery.event.special[ type ] || {};

			// If selector defined, determine special event api type, otherwise given type
			type = ( selector ? special.delegateType : special.bindType ) || type;

			// Update special based on newly reset type
			special = jQuery.event.special[ type ] || {};

			// handleObj is passed to all event handlers
			handleObj = jQuery.extend({
				type: type,
				origType: origType,
				data: data,
				handler: handler,
				guid: handler.guid,
				selector: selector,
				needsContext: selector && jQuery.expr.match.needsContext.test( selector ),
				namespace: namespaces.join(".")
			}, handleObjIn );

			// Init the event handler queue if we're the first
			if ( !(handlers = events[ type ]) ) {
				handlers = events[ type ] = [];
				handlers.delegateCount = 0;

				// Only use addEventListener/attachEvent if the special events handler returns false
				if ( !special.setup || special.setup.call( elem, data, namespaces, eventHandle ) === false ) {
					// Bind the global event handler to the element
					if ( elem.addEventListener ) {
						elem.addEventListener( type, eventHandle, false );

					} else if ( elem.attachEvent ) {
						elem.attachEvent( "on" + type, eventHandle );
					}
				}
			}

			if ( special.add ) {
				special.add.call( elem, handleObj );

				if ( !handleObj.handler.guid ) {
					handleObj.handler.guid = handler.guid;
				}
			}

			// Add to the element's handler list, delegates in front
			if ( selector ) {
				handlers.splice( handlers.delegateCount++, 0, handleObj );
			} else {
				handlers.push( handleObj );
			}

			// Keep track of which events have ever been used, for event optimization
			jQuery.event.global[ type ] = true;
		}

		// Nullify elem to prevent memory leaks in IE
		elem = null;
	},

	// Detach an event or set of events from an element
	remove: function( elem, types, handler, selector, mappedTypes ) {
		var j, handleObj, tmp,
			origCount, t, events,
			special, handlers, type,
			namespaces, origType,
			elemData = jQuery.hasData( elem ) && jQuery._data( elem );

		if ( !elemData || !(events = elemData.events) ) {
			return;
		}

		// Once for each type.namespace in types; type may be omitted
		types = ( types || "" ).match( rnotwhite ) || [ "" ];
		t = types.length;
		while ( t-- ) {
			tmp = rtypenamespace.exec( types[t] ) || [];
			type = origType = tmp[1];
			namespaces = ( tmp[2] || "" ).split( "." ).sort();

			// Unbind all events (on this namespace, if provided) for the element
			if ( !type ) {
				for ( type in events ) {
					jQuery.event.remove( elem, type + types[ t ], handler, selector, true );
				}
				continue;
			}

			special = jQuery.event.special[ type ] || {};
			type = ( selector ? special.delegateType : special.bindType ) || type;
			handlers = events[ type ] || [];
			tmp = tmp[2] && new RegExp( "(^|\\.)" + namespaces.join("\\.(?:.*\\.|)") + "(\\.|$)" );

			// Remove matching events
			origCount = j = handlers.length;
			while ( j-- ) {
				handleObj = handlers[ j ];

				if ( ( mappedTypes || origType === handleObj.origType ) &&
					( !handler || handler.guid === handleObj.guid ) &&
					( !tmp || tmp.test( handleObj.namespace ) ) &&
					( !selector || selector === handleObj.selector || selector === "**" && handleObj.selector ) ) {
					handlers.splice( j, 1 );

					if ( handleObj.selector ) {
						handlers.delegateCount--;
					}
					if ( special.remove ) {
						special.remove.call( elem, handleObj );
					}
				}
			}

			// Remove generic event handler if we removed something and no more handlers exist
			// (avoids potential for endless recursion during removal of special event handlers)
			if ( origCount && !handlers.length ) {
				if ( !special.teardown || special.teardown.call( elem, namespaces, elemData.handle ) === false ) {
					jQuery.removeEvent( elem, type, elemData.handle );
				}

				delete events[ type ];
			}
		}

		// Remove the expando if it's no longer used
		if ( jQuery.isEmptyObject( events ) ) {
			delete elemData.handle;

			// removeData also checks for emptiness and clears the expando if empty
			// so use it instead of delete
			jQuery._removeData( elem, "events" );
		}
	},

	trigger: function( event, data, elem, onlyHandlers ) {
		var handle, ontype, cur,
			bubbleType, special, tmp, i,
			eventPath = [ elem || document ],
			type = hasOwn.call( event, "type" ) ? event.type : event,
			namespaces = hasOwn.call( event, "namespace" ) ? event.namespace.split(".") : [];

		cur = tmp = elem = elem || document;

		// Don't do events on text and comment nodes
		if ( elem.nodeType === 3 || elem.nodeType === 8 ) {
			return;
		}

		// focus/blur morphs to focusin/out; ensure we're not firing them right now
		if ( rfocusMorph.test( type + jQuery.event.triggered ) ) {
			return;
		}

		if ( type.indexOf(".") >= 0 ) {
			// Namespaced trigger; create a regexp to match event type in handle()
			namespaces = type.split(".");
			type = namespaces.shift();
			namespaces.sort();
		}
		ontype = type.indexOf(":") < 0 && "on" + type;

		// Caller can pass in a jQuery.Event object, Object, or just an event type string
		event = event[ jQuery.expando ] ?
			event :
			new jQuery.Event( type, typeof event === "object" && event );

		// Trigger bitmask: & 1 for native handlers; & 2 for jQuery (always true)
		event.isTrigger = onlyHandlers ? 2 : 3;
		event.namespace = namespaces.join(".");
		event.namespace_re = event.namespace ?
			new RegExp( "(^|\\.)" + namespaces.join("\\.(?:.*\\.|)") + "(\\.|$)" ) :
			null;

		// Clean up the event in case it is being reused
		event.result = undefined;
		if ( !event.target ) {
			event.target = elem;
		}

		// Clone any incoming data and prepend the event, creating the handler arg list
		data = data == null ?
			[ event ] :
			jQuery.makeArray( data, [ event ] );

		// Allow special events to draw outside the lines
		special = jQuery.event.special[ type ] || {};
		if ( !onlyHandlers && special.trigger && special.trigger.apply( elem, data ) === false ) {
			return;
		}

		// Determine event propagation path in advance, per W3C events spec (#9951)
		// Bubble up to document, then to window; watch for a global ownerDocument var (#9724)
		if ( !onlyHandlers && !special.noBubble && !jQuery.isWindow( elem ) ) {

			bubbleType = special.delegateType || type;
			if ( !rfocusMorph.test( bubbleType + type ) ) {
				cur = cur.parentNode;
			}
			for ( ; cur; cur = cur.parentNode ) {
				eventPath.push( cur );
				tmp = cur;
			}

			// Only add window if we got to document (e.g., not plain obj or detached DOM)
			if ( tmp === (elem.ownerDocument || document) ) {
				eventPath.push( tmp.defaultView || tmp.parentWindow || window );
			}
		}

		// Fire handlers on the event path
		i = 0;
		while ( (cur = eventPath[i++]) && !event.isPropagationStopped() ) {

			event.type = i > 1 ?
				bubbleType :
				special.bindType || type;

			// jQuery handler
			handle = ( jQuery._data( cur, "events" ) || {} )[ event.type ] && jQuery._data( cur, "handle" );
			if ( handle ) {
				handle.apply( cur, data );
			}

			// Native handler
			handle = ontype && cur[ ontype ];
			if ( handle && handle.apply && jQuery.acceptData( cur ) ) {
				event.result = handle.apply( cur, data );
				if ( event.result === false ) {
					event.preventDefault();
				}
			}
		}
		event.type = type;

		// If nobody prevented the default action, do it now
		if ( !onlyHandlers && !event.isDefaultPrevented() ) {

			if ( (!special._default || special._default.apply( eventPath.pop(), data ) === false) &&
				jQuery.acceptData( elem ) ) {

				// Call a native DOM method on the target with the same name name as the event.
				// Can't use an .isFunction() check here because IE6/7 fails that test.
				// Don't do default actions on window, that's where global variables be (#6170)
				if ( ontype && elem[ type ] && !jQuery.isWindow( elem ) ) {

					// Don't re-trigger an onFOO event when we call its FOO() method
					tmp = elem[ ontype ];

					if ( tmp ) {
						elem[ ontype ] = null;
					}

					// Prevent re-triggering of the same event, since we already bubbled it above
					jQuery.event.triggered = type;
					try {
						elem[ type ]();
					} catch ( e ) {
						// IE<9 dies on focus/blur to hidden element (#1486,#12518)
						// only reproducible on winXP IE8 native, not IE9 in IE8 mode
					}
					jQuery.event.triggered = undefined;

					if ( tmp ) {
						elem[ ontype ] = tmp;
					}
				}
			}
		}

		return event.result;
	},

	dispatch: function( event ) {

		// Make a writable jQuery.Event from the native event object
		event = jQuery.event.fix( event );

		var i, ret, handleObj, matched, j,
			handlerQueue = [],
			args = slice.call( arguments ),
			handlers = ( jQuery._data( this, "events" ) || {} )[ event.type ] || [],
			special = jQuery.event.special[ event.type ] || {};

		// Use the fix-ed jQuery.Event rather than the (read-only) native event
		args[0] = event;
		event.delegateTarget = this;

		// Call the preDispatch hook for the mapped type, and let it bail if desired
		if ( special.preDispatch && special.preDispatch.call( this, event ) === false ) {
			return;
		}

		// Determine handlers
		handlerQueue = jQuery.event.handlers.call( this, event, handlers );

		// Run delegates first; they may want to stop propagation beneath us
		i = 0;
		while ( (matched = handlerQueue[ i++ ]) && !event.isPropagationStopped() ) {
			event.currentTarget = matched.elem;

			j = 0;
			while ( (handleObj = matched.handlers[ j++ ]) && !event.isImmediatePropagationStopped() ) {

				// Triggered event must either 1) have no namespace, or
				// 2) have namespace(s) a subset or equal to those in the bound event (both can have no namespace).
				if ( !event.namespace_re || event.namespace_re.test( handleObj.namespace ) ) {

					event.handleObj = handleObj;
					event.data = handleObj.data;

					ret = ( (jQuery.event.special[ handleObj.origType ] || {}).handle || handleObj.handler )
							.apply( matched.elem, args );

					if ( ret !== undefined ) {
						if ( (event.result = ret) === false ) {
							event.preventDefault();
							event.stopPropagation();
						}
					}
				}
			}
		}

		// Call the postDispatch hook for the mapped type
		if ( special.postDispatch ) {
			special.postDispatch.call( this, event );
		}

		return event.result;
	},

	handlers: function( event, handlers ) {
		var sel, handleObj, matches, i,
			handlerQueue = [],
			delegateCount = handlers.delegateCount,
			cur = event.target;

		// Find delegate handlers
		// Black-hole SVG <use> instance trees (#13180)
		// Avoid non-left-click bubbling in Firefox (#3861)
		if ( delegateCount && cur.nodeType && (!event.button || event.type !== "click") ) {

			/* jshint eqeqeq: false */
			for ( ; cur != this; cur = cur.parentNode || this ) {
				/* jshint eqeqeq: true */

				// Don't check non-elements (#13208)
				// Don't process clicks on disabled elements (#6911, #8165, #11382, #11764)
				if ( cur.nodeType === 1 && (cur.disabled !== true || event.type !== "click") ) {
					matches = [];
					for ( i = 0; i < delegateCount; i++ ) {
						handleObj = handlers[ i ];

						// Don't conflict with Object.prototype properties (#13203)
						sel = handleObj.selector + " ";

						if ( matches[ sel ] === undefined ) {
							matches[ sel ] = handleObj.needsContext ?
								jQuery( sel, this ).index( cur ) >= 0 :
								jQuery.find( sel, this, null, [ cur ] ).length;
						}
						if ( matches[ sel ] ) {
							matches.push( handleObj );
						}
					}
					if ( matches.length ) {
						handlerQueue.push({ elem: cur, handlers: matches });
					}
				}
			}
		}

		// Add the remaining (directly-bound) handlers
		if ( delegateCount < handlers.length ) {
			handlerQueue.push({ elem: this, handlers: handlers.slice( delegateCount ) });
		}

		return handlerQueue;
	},

	fix: function( event ) {
		if ( event[ jQuery.expando ] ) {
			return event;
		}

		// Create a writable copy of the event object and normalize some properties
		var i, prop, copy,
			type = event.type,
			originalEvent = event,
			fixHook = this.fixHooks[ type ];

		if ( !fixHook ) {
			this.fixHooks[ type ] = fixHook =
				rmouseEvent.test( type ) ? this.mouseHooks :
				rkeyEvent.test( type ) ? this.keyHooks :
				{};
		}
		copy = fixHook.props ? this.props.concat( fixHook.props ) : this.props;

		event = new jQuery.Event( originalEvent );

		i = copy.length;
		while ( i-- ) {
			prop = copy[ i ];
			event[ prop ] = originalEvent[ prop ];
		}

		// Support: IE<9
		// Fix target property (#1925)
		if ( !event.target ) {
			event.target = originalEvent.srcElement || document;
		}

		// Support: Chrome 23+, Safari?
		// Target should not be a text node (#504, #13143)
		if ( event.target.nodeType === 3 ) {
			event.target = event.target.parentNode;
		}

		// Support: IE<9
		// For mouse/key events, metaKey==false if it's undefined (#3368, #11328)
		event.metaKey = !!event.metaKey;

		return fixHook.filter ? fixHook.filter( event, originalEvent ) : event;
	},

	// Includes some event props shared by KeyEvent and MouseEvent
	props: "altKey bubbles cancelable ctrlKey currentTarget eventPhase metaKey relatedTarget shiftKey target timeStamp view which".split(" "),

	fixHooks: {},

	keyHooks: {
		props: "char charCode key keyCode".split(" "),
		filter: function( event, original ) {

			// Add which for key events
			if ( event.which == null ) {
				event.which = original.charCode != null ? original.charCode : original.keyCode;
			}

			return event;
		}
	},

	mouseHooks: {
		props: "button buttons clientX clientY fromElement offsetX offsetY pageX pageY screenX screenY toElement".split(" "),
		filter: function( event, original ) {
			var body, eventDoc, doc,
				button = original.button,
				fromElement = original.fromElement;

			// Calculate pageX/Y if missing and clientX/Y available
			if ( event.pageX == null && original.clientX != null ) {
				eventDoc = event.target.ownerDocument || document;
				doc = eventDoc.documentElement;
				body = eventDoc.body;

				event.pageX = original.clientX + ( doc && doc.scrollLeft || body && body.scrollLeft || 0 ) - ( doc && doc.clientLeft || body && body.clientLeft || 0 );
				event.pageY = original.clientY + ( doc && doc.scrollTop  || body && body.scrollTop  || 0 ) - ( doc && doc.clientTop  || body && body.clientTop  || 0 );
			}

			// Add relatedTarget, if necessary
			if ( !event.relatedTarget && fromElement ) {
				event.relatedTarget = fromElement === event.target ? original.toElement : fromElement;
			}

			// Add which for click: 1 === left; 2 === middle; 3 === right
			// Note: button is not normalized, so don't use it
			if ( !event.which && button !== undefined ) {
				event.which = ( button & 1 ? 1 : ( button & 2 ? 3 : ( button & 4 ? 2 : 0 ) ) );
			}

			return event;
		}
	},

	special: {
		load: {
			// Prevent triggered image.load events from bubbling to window.load
			noBubble: true
		},
		focus: {
			// Fire native event if possible so blur/focus sequence is correct
			trigger: function() {
				if ( this !== safeActiveElement() && this.focus ) {
					try {
						this.focus();
						return false;
					} catch ( e ) {
						// Support: IE<9
						// If we error on focus to hidden element (#1486, #12518),
						// let .trigger() run the handlers
					}
				}
			},
			delegateType: "focusin"
		},
		blur: {
			trigger: function() {
				if ( this === safeActiveElement() && this.blur ) {
					this.blur();
					return false;
				}
			},
			delegateType: "focusout"
		},
		click: {
			// For checkbox, fire native event so checked state will be right
			trigger: function() {
				if ( jQuery.nodeName( this, "input" ) && this.type === "checkbox" && this.click ) {
					this.click();
					return false;
				}
			},

			// For cross-browser consistency, don't fire native .click() on links
			_default: function( event ) {
				return jQuery.nodeName( event.target, "a" );
			}
		},

		beforeunload: {
			postDispatch: function( event ) {

				// Support: Firefox 20+
				// Firefox doesn't alert if the returnValue field is not set.
				if ( event.result !== undefined && event.originalEvent ) {
					event.originalEvent.returnValue = event.result;
				}
			}
		}
	},

	simulate: function( type, elem, event, bubble ) {
		// Piggyback on a donor event to simulate a different one.
		// Fake originalEvent to avoid donor's stopPropagation, but if the
		// simulated event prevents default then we do the same on the donor.
		var e = jQuery.extend(
			new jQuery.Event(),
			event,
			{
				type: type,
				isSimulated: true,
				originalEvent: {}
			}
		);
		if ( bubble ) {
			jQuery.event.trigger( e, null, elem );
		} else {
			jQuery.event.dispatch.call( elem, e );
		}
		if ( e.isDefaultPrevented() ) {
			event.preventDefault();
		}
	}
};

jQuery.removeEvent = document.removeEventListener ?
	function( elem, type, handle ) {
		if ( elem.removeEventListener ) {
			elem.removeEventListener( type, handle, false );
		}
	} :
	function( elem, type, handle ) {
		var name = "on" + type;

		if ( elem.detachEvent ) {

			// #8545, #7054, preventing memory leaks for custom events in IE6-8
			// detachEvent needed property on element, by name of that event, to properly expose it to GC
			if ( typeof elem[ name ] === strundefined ) {
				elem[ name ] = null;
			}

			elem.detachEvent( name, handle );
		}
	};

jQuery.Event = function( src, props ) {
	// Allow instantiation without the 'new' keyword
	if ( !(this instanceof jQuery.Event) ) {
		return new jQuery.Event( src, props );
	}

	// Event object
	if ( src && src.type ) {
		this.originalEvent = src;
		this.type = src.type;

		// Events bubbling up the document may have been marked as prevented
		// by a handler lower down the tree; reflect the correct value.
		this.isDefaultPrevented = src.defaultPrevented ||
				src.defaultPrevented === undefined &&
				// Support: IE < 9, Android < 4.0
				src.returnValue === false ?
			returnTrue :
			returnFalse;

	// Event type
	} else {
		this.type = src;
	}

	// Put explicitly provided properties onto the event object
	if ( props ) {
		jQuery.extend( this, props );
	}

	// Create a timestamp if incoming event doesn't have one
	this.timeStamp = src && src.timeStamp || jQuery.now();

	// Mark it as fixed
	this[ jQuery.expando ] = true;
};

// jQuery.Event is based on DOM3 Events as specified by the ECMAScript Language Binding
// http://www.w3.org/TR/2003/WD-DOM-Level-3-Events-20030331/ecma-script-binding.html
jQuery.Event.prototype = {
	isDefaultPrevented: returnFalse,
	isPropagationStopped: returnFalse,
	isImmediatePropagationStopped: returnFalse,

	preventDefault: function() {
		var e = this.originalEvent;

		this.isDefaultPrevented = returnTrue;
		if ( !e ) {
			return;
		}

		// If preventDefault exists, run it on the original event
		if ( e.preventDefault ) {
			e.preventDefault();

		// Support: IE
		// Otherwise set the returnValue property of the original event to false
		} else {
			e.returnValue = false;
		}
	},
	stopPropagation: function() {
		var e = this.originalEvent;

		this.isPropagationStopped = returnTrue;
		if ( !e ) {
			return;
		}
		// If stopPropagation exists, run it on the original event
		if ( e.stopPropagation ) {
			e.stopPropagation();
		}

		// Support: IE
		// Set the cancelBubble property of the original event to true
		e.cancelBubble = true;
	},
	stopImmediatePropagation: function() {
		var e = this.originalEvent;

		this.isImmediatePropagationStopped = returnTrue;

		if ( e && e.stopImmediatePropagation ) {
			e.stopImmediatePropagation();
		}

		this.stopPropagation();
	}
};

// Create mouseenter/leave events using mouseover/out and event-time checks
jQuery.each({
	mouseenter: "mouseover",
	mouseleave: "mouseout",
	pointerenter: "pointerover",
	pointerleave: "pointerout"
}, function( orig, fix ) {
	jQuery.event.special[ orig ] = {
		delegateType: fix,
		bindType: fix,

		handle: function( event ) {
			var ret,
				target = this,
				related = event.relatedTarget,
				handleObj = event.handleObj;

			// For mousenter/leave call the handler if related is outside the target.
			// NB: No relatedTarget if the mouse left/entered the browser window
			if ( !related || (related !== target && !jQuery.contains( target, related )) ) {
				event.type = handleObj.origType;
				ret = handleObj.handler.apply( this, arguments );
				event.type = fix;
			}
			return ret;
		}
	};
});

// IE submit delegation
if ( !support.submitBubbles ) {

	jQuery.event.special.submit = {
		setup: function() {
			// Only need this for delegated form submit events
			if ( jQuery.nodeName( this, "form" ) ) {
				return false;
			}

			// Lazy-add a submit handler when a descendant form may potentially be submitted
			jQuery.event.add( this, "click._submit keypress._submit", function( e ) {
				// Node name check avoids a VML-related crash in IE (#9807)
				var elem = e.target,
					form = jQuery.nodeName( elem, "input" ) || jQuery.nodeName( elem, "button" ) ? elem.form : undefined;
				if ( form && !jQuery._data( form, "submitBubbles" ) ) {
					jQuery.event.add( form, "submit._submit", function( event ) {
						event._submit_bubble = true;
					});
					jQuery._data( form, "submitBubbles", true );
				}
			});
			// return undefined since we don't need an event listener
		},

		postDispatch: function( event ) {
			// If form was submitted by the user, bubble the event up the tree
			if ( event._submit_bubble ) {
				delete event._submit_bubble;
				if ( this.parentNode && !event.isTrigger ) {
					jQuery.event.simulate( "submit", this.parentNode, event, true );
				}
			}
		},

		teardown: function() {
			// Only need this for delegated form submit events
			if ( jQuery.nodeName( this, "form" ) ) {
				return false;
			}

			// Remove delegated handlers; cleanData eventually reaps submit handlers attached above
			jQuery.event.remove( this, "._submit" );
		}
	};
}

// IE change delegation and checkbox/radio fix
if ( !support.changeBubbles ) {

	jQuery.event.special.change = {

		setup: function() {

			if ( rformElems.test( this.nodeName ) ) {
				// IE doesn't fire change on a check/radio until blur; trigger it on click
				// after a propertychange. Eat the blur-change in special.change.handle.
				// This still fires onchange a second time for check/radio after blur.
				if ( this.type === "checkbox" || this.type === "radio" ) {
					jQuery.event.add( this, "propertychange._change", function( event ) {
						if ( event.originalEvent.propertyName === "checked" ) {
							this._just_changed = true;
						}
					});
					jQuery.event.add( this, "click._change", function( event ) {
						if ( this._just_changed && !event.isTrigger ) {
							this._just_changed = false;
						}
						// Allow triggered, simulated change events (#11500)
						jQuery.event.simulate( "change", this, event, true );
					});
				}
				return false;
			}
			// Delegated event; lazy-add a change handler on descendant inputs
			jQuery.event.add( this, "beforeactivate._change", function( e ) {
				var elem = e.target;

				if ( rformElems.test( elem.nodeName ) && !jQuery._data( elem, "changeBubbles" ) ) {
					jQuery.event.add( elem, "change._change", function( event ) {
						if ( this.parentNode && !event.isSimulated && !event.isTrigger ) {
							jQuery.event.simulate( "change", this.parentNode, event, true );
						}
					});
					jQuery._data( elem, "changeBubbles", true );
				}
			});
		},

		handle: function( event ) {
			var elem = event.target;

			// Swallow native change events from checkbox/radio, we already triggered them above
			if ( this !== elem || event.isSimulated || event.isTrigger || (elem.type !== "radio" && elem.type !== "checkbox") ) {
				return event.handleObj.handler.apply( this, arguments );
			}
		},

		teardown: function() {
			jQuery.event.remove( this, "._change" );

			return !rformElems.test( this.nodeName );
		}
	};
}

// Create "bubbling" focus and blur events
if ( !support.focusinBubbles ) {
	jQuery.each({ focus: "focusin", blur: "focusout" }, function( orig, fix ) {

		// Attach a single capturing handler on the document while someone wants focusin/focusout
		var handler = function( event ) {
				jQuery.event.simulate( fix, event.target, jQuery.event.fix( event ), true );
			};

		jQuery.event.special[ fix ] = {
			setup: function() {
				var doc = this.ownerDocument || this,
					attaches = jQuery._data( doc, fix );

				if ( !attaches ) {
					doc.addEventListener( orig, handler, true );
				}
				jQuery._data( doc, fix, ( attaches || 0 ) + 1 );
			},
			teardown: function() {
				var doc = this.ownerDocument || this,
					attaches = jQuery._data( doc, fix ) - 1;

				if ( !attaches ) {
					doc.removeEventListener( orig, handler, true );
					jQuery._removeData( doc, fix );
				} else {
					jQuery._data( doc, fix, attaches );
				}
			}
		};
	});
}

jQuery.fn.extend({

	on: function( types, selector, data, fn, /*INTERNAL*/ one ) {
		var type, origFn;

		// Types can be a map of types/handlers
		if ( typeof types === "object" ) {
			// ( types-Object, selector, data )
			if ( typeof selector !== "string" ) {
				// ( types-Object, data )
				data = data || selector;
				selector = undefined;
			}
			for ( type in types ) {
				this.on( type, selector, data, types[ type ], one );
			}
			return this;
		}

		if ( data == null && fn == null ) {
			// ( types, fn )
			fn = selector;
			data = selector = undefined;
		} else if ( fn == null ) {
			if ( typeof selector === "string" ) {
				// ( types, selector, fn )
				fn = data;
				data = undefined;
			} else {
				// ( types, data, fn )
				fn = data;
				data = selector;
				selector = undefined;
			}
		}
		if ( fn === false ) {
			fn = returnFalse;
		} else if ( !fn ) {
			return this;
		}

		if ( one === 1 ) {
			origFn = fn;
			fn = function( event ) {
				// Can use an empty set, since event contains the info
				jQuery().off( event );
				return origFn.apply( this, arguments );
			};
			// Use same guid so caller can remove using origFn
			fn.guid = origFn.guid || ( origFn.guid = jQuery.guid++ );
		}
		return this.each( function() {
			jQuery.event.add( this, types, fn, data, selector );
		});
	},
	one: function( types, selector, data, fn ) {
		return this.on( types, selector, data, fn, 1 );
	},
	off: function( types, selector, fn ) {
		var handleObj, type;
		if ( types && types.preventDefault && types.handleObj ) {
			// ( event )  dispatched jQuery.Event
			handleObj = types.handleObj;
			jQuery( types.delegateTarget ).off(
				handleObj.namespace ? handleObj.origType + "." + handleObj.namespace : handleObj.origType,
				handleObj.selector,
				handleObj.handler
			);
			return this;
		}
		if ( typeof types === "object" ) {
			// ( types-object [, selector] )
			for ( type in types ) {
				this.off( type, selector, types[ type ] );
			}
			return this;
		}
		if ( selector === false || typeof selector === "function" ) {
			// ( types [, fn] )
			fn = selector;
			selector = undefined;
		}
		if ( fn === false ) {
			fn = returnFalse;
		}
		return this.each(function() {
			jQuery.event.remove( this, types, fn, selector );
		});
	},

	trigger: function( type, data ) {
		return this.each(function() {
			jQuery.event.trigger( type, data, this );
		});
	},
	triggerHandler: function( type, data ) {
		var elem = this[0];
		if ( elem ) {
			return jQuery.event.trigger( type, data, elem, true );
		}
	}
});


function createSafeFragment( document ) {
	var list = nodeNames.split( "|" ),
		safeFrag = document.createDocumentFragment();

	if ( safeFrag.createElement ) {
		while ( list.length ) {
			safeFrag.createElement(
				list.pop()
			);
		}
	}
	return safeFrag;
}

var nodeNames = "abbr|article|aside|audio|bdi|canvas|data|datalist|details|figcaption|figure|footer|" +
		"header|hgroup|mark|meter|nav|output|progress|section|summary|time|video",
	rinlinejQuery = / jQuery\d+="(?:null|\d+)"/g,
	rnoshimcache = new RegExp("<(?:" + nodeNames + ")[\\s/>]", "i"),
	rleadingWhitespace = /^\s+/,
	rxhtmlTag = /<(?!area|br|col|embed|hr|img|input|link|meta|param)(([\w:]+)[^>]*)\/>/gi,
	rtagName = /<([\w:]+)/,
	rtbody = /<tbody/i,
	rhtml = /<|&#?\w+;/,
	rnoInnerhtml = /<(?:script|style|link)/i,
	// checked="checked" or checked
	rchecked = /checked\s*(?:[^=]|=\s*.checked.)/i,
	rscriptType = /^$|\/(?:java|ecma)script/i,
	rscriptTypeMasked = /^true\/(.*)/,
	rcleanScript = /^\s*<!(?:\[CDATA\[|--)|(?:\]\]|--)>\s*$/g,

	// We have to close these tags to support XHTML (#13200)
	wrapMap = {
		option: [ 1, "<select multiple='multiple'>", "</select>" ],
		legend: [ 1, "<fieldset>", "</fieldset>" ],
		area: [ 1, "<map>", "</map>" ],
		param: [ 1, "<object>", "</object>" ],
		thead: [ 1, "<table>", "</table>" ],
		tr: [ 2, "<table><tbody>", "</tbody></table>" ],
		col: [ 2, "<table><tbody></tbody><colgroup>", "</colgroup></table>" ],
		td: [ 3, "<table><tbody><tr>", "</tr></tbody></table>" ],

		// IE6-8 can't serialize link, script, style, or any html5 (NoScope) tags,
		// unless wrapped in a div with non-breaking characters in front of it.
		_default: support.htmlSerialize ? [ 0, "", "" ] : [ 1, "X<div>", "</div>"  ]
	},
	safeFragment = createSafeFragment( document ),
	fragmentDiv = safeFragment.appendChild( document.createElement("div") );

wrapMap.optgroup = wrapMap.option;
wrapMap.tbody = wrapMap.tfoot = wrapMap.colgroup = wrapMap.caption = wrapMap.thead;
wrapMap.th = wrapMap.td;

function getAll( context, tag ) {
	var elems, elem,
		i = 0,
		found = typeof context.getElementsByTagName !== strundefined ? context.getElementsByTagName( tag || "*" ) :
			typeof context.querySelectorAll !== strundefined ? context.querySelectorAll( tag || "*" ) :
			undefined;

	if ( !found ) {
		for ( found = [], elems = context.childNodes || context; (elem = elems[i]) != null; i++ ) {
			if ( !tag || jQuery.nodeName( elem, tag ) ) {
				found.push( elem );
			} else {
				jQuery.merge( found, getAll( elem, tag ) );
			}
		}
	}

	return tag === undefined || tag && jQuery.nodeName( context, tag ) ?
		jQuery.merge( [ context ], found ) :
		found;
}

// Used in buildFragment, fixes the defaultChecked property
function fixDefaultChecked( elem ) {
	if ( rcheckableType.test( elem.type ) ) {
		elem.defaultChecked = elem.checked;
	}
}

// Support: IE<8
// Manipulating tables requires a tbody
function manipulationTarget( elem, content ) {
	return jQuery.nodeName( elem, "table" ) &&
		jQuery.nodeName( content.nodeType !== 11 ? content : content.firstChild, "tr" ) ?

		elem.getElementsByTagName("tbody")[0] ||
			elem.appendChild( elem.ownerDocument.createElement("tbody") ) :
		elem;
}

// Replace/restore the type attribute of script elements for safe DOM manipulation
function disableScript( elem ) {
	elem.type = (jQuery.find.attr( elem, "type" ) !== null) + "/" + elem.type;
	return elem;
}
function restoreScript( elem ) {
	var match = rscriptTypeMasked.exec( elem.type );
	if ( match ) {
		elem.type = match[1];
	} else {
		elem.removeAttribute("type");
	}
	return elem;
}

// Mark scripts as having already been evaluated
function setGlobalEval( elems, refElements ) {
	var elem,
		i = 0;
	for ( ; (elem = elems[i]) != null; i++ ) {
		jQuery._data( elem, "globalEval", !refElements || jQuery._data( refElements[i], "globalEval" ) );
	}
}

function cloneCopyEvent( src, dest ) {

	if ( dest.nodeType !== 1 || !jQuery.hasData( src ) ) {
		return;
	}

	var type, i, l,
		oldData = jQuery._data( src ),
		curData = jQuery._data( dest, oldData ),
		events = oldData.events;

	if ( events ) {
		delete curData.handle;
		curData.events = {};

		for ( type in events ) {
			for ( i = 0, l = events[ type ].length; i < l; i++ ) {
				jQuery.event.add( dest, type, events[ type ][ i ] );
			}
		}
	}

	// make the cloned public data object a copy from the original
	if ( curData.data ) {
		curData.data = jQuery.extend( {}, curData.data );
	}
}

function fixCloneNodeIssues( src, dest ) {
	var nodeName, e, data;

	// We do not need to do anything for non-Elements
	if ( dest.nodeType !== 1 ) {
		return;
	}

	nodeName = dest.nodeName.toLowerCase();

	// IE6-8 copies events bound via attachEvent when using cloneNode.
	if ( !support.noCloneEvent && dest[ jQuery.expando ] ) {
		data = jQuery._data( dest );

		for ( e in data.events ) {
			jQuery.removeEvent( dest, e, data.handle );
		}

		// Event data gets referenced instead of copied if the expando gets copied too
		dest.removeAttribute( jQuery.expando );
	}

	// IE blanks contents when cloning scripts, and tries to evaluate newly-set text
	if ( nodeName === "script" && dest.text !== src.text ) {
		disableScript( dest ).text = src.text;
		restoreScript( dest );

	// IE6-10 improperly clones children of object elements using classid.
	// IE10 throws NoModificationAllowedError if parent is null, #12132.
	} else if ( nodeName === "object" ) {
		if ( dest.parentNode ) {
			dest.outerHTML = src.outerHTML;
		}

		// This path appears unavoidable for IE9. When cloning an object
		// element in IE9, the outerHTML strategy above is not sufficient.
		// If the src has innerHTML and the destination does not,
		// copy the src.innerHTML into the dest.innerHTML. #10324
		if ( support.html5Clone && ( src.innerHTML && !jQuery.trim(dest.innerHTML) ) ) {
			dest.innerHTML = src.innerHTML;
		}

	} else if ( nodeName === "input" && rcheckableType.test( src.type ) ) {
		// IE6-8 fails to persist the checked state of a cloned checkbox
		// or radio button. Worse, IE6-7 fail to give the cloned element
		// a checked appearance if the defaultChecked value isn't also set

		dest.defaultChecked = dest.checked = src.checked;

		// IE6-7 get confused and end up setting the value of a cloned
		// checkbox/radio button to an empty string instead of "on"
		if ( dest.value !== src.value ) {
			dest.value = src.value;
		}

	// IE6-8 fails to return the selected option to the default selected
	// state when cloning options
	} else if ( nodeName === "option" ) {
		dest.defaultSelected = dest.selected = src.defaultSelected;

	// IE6-8 fails to set the defaultValue to the correct value when
	// cloning other types of input fields
	} else if ( nodeName === "input" || nodeName === "textarea" ) {
		dest.defaultValue = src.defaultValue;
	}
}

jQuery.extend({
	clone: function( elem, dataAndEvents, deepDataAndEvents ) {
		var destElements, node, clone, i, srcElements,
			inPage = jQuery.contains( elem.ownerDocument, elem );

		if ( support.html5Clone || jQuery.isXMLDoc(elem) || !rnoshimcache.test( "<" + elem.nodeName + ">" ) ) {
			clone = elem.cloneNode( true );

		// IE<=8 does not properly clone detached, unknown element nodes
		} else {
			fragmentDiv.innerHTML = elem.outerHTML;
			fragmentDiv.removeChild( clone = fragmentDiv.firstChild );
		}

		if ( (!support.noCloneEvent || !support.noCloneChecked) &&
				(elem.nodeType === 1 || elem.nodeType === 11) && !jQuery.isXMLDoc(elem) ) {

			// We eschew Sizzle here for performance reasons: http://jsperf.com/getall-vs-sizzle/2
			destElements = getAll( clone );
			srcElements = getAll( elem );

			// Fix all IE cloning issues
			for ( i = 0; (node = srcElements[i]) != null; ++i ) {
				// Ensure that the destination node is not null; Fixes #9587
				if ( destElements[i] ) {
					fixCloneNodeIssues( node, destElements[i] );
				}
			}
		}

		// Copy the events from the original to the clone
		if ( dataAndEvents ) {
			if ( deepDataAndEvents ) {
				srcElements = srcElements || getAll( elem );
				destElements = destElements || getAll( clone );

				for ( i = 0; (node = srcElements[i]) != null; i++ ) {
					cloneCopyEvent( node, destElements[i] );
				}
			} else {
				cloneCopyEvent( elem, clone );
			}
		}

		// Preserve script evaluation history
		destElements = getAll( clone, "script" );
		if ( destElements.length > 0 ) {
			setGlobalEval( destElements, !inPage && getAll( elem, "script" ) );
		}

		destElements = srcElements = node = null;

		// Return the cloned set
		return clone;
	},

	buildFragment: function( elems, context, scripts, selection ) {
		var j, elem, contains,
			tmp, tag, tbody, wrap,
			l = elems.length,

			// Ensure a safe fragment
			safe = createSafeFragment( context ),

			nodes = [],
			i = 0;

		for ( ; i < l; i++ ) {
			elem = elems[ i ];

			if ( elem || elem === 0 ) {

				// Add nodes directly
				if ( jQuery.type( elem ) === "object" ) {
					jQuery.merge( nodes, elem.nodeType ? [ elem ] : elem );

				// Convert non-html into a text node
				} else if ( !rhtml.test( elem ) ) {
					nodes.push( context.createTextNode( elem ) );

				// Convert html into DOM nodes
				} else {
					tmp = tmp || safe.appendChild( context.createElement("div") );

					// Deserialize a standard representation
					tag = (rtagName.exec( elem ) || [ "", "" ])[ 1 ].toLowerCase();
					wrap = wrapMap[ tag ] || wrapMap._default;

					tmp.innerHTML = wrap[1] + elem.replace( rxhtmlTag, "<$1></$2>" ) + wrap[2];

					// Descend through wrappers to the right content
					j = wrap[0];
					while ( j-- ) {
						tmp = tmp.lastChild;
					}

					// Manually add leading whitespace removed by IE
					if ( !support.leadingWhitespace && rleadingWhitespace.test( elem ) ) {
						nodes.push( context.createTextNode( rleadingWhitespace.exec( elem )[0] ) );
					}

					// Remove IE's autoinserted <tbody> from table fragments
					if ( !support.tbody ) {

						// String was a <table>, *may* have spurious <tbody>
						elem = tag === "table" && !rtbody.test( elem ) ?
							tmp.firstChild :

							// String was a bare <thead> or <tfoot>
							wrap[1] === "<table>" && !rtbody.test( elem ) ?
								tmp :
								0;

						j = elem && elem.childNodes.length;
						while ( j-- ) {
							if ( jQuery.nodeName( (tbody = elem.childNodes[j]), "tbody" ) && !tbody.childNodes.length ) {
								elem.removeChild( tbody );
							}
						}
					}

					jQuery.merge( nodes, tmp.childNodes );

					// Fix #12392 for WebKit and IE > 9
					tmp.textContent = "";

					// Fix #12392 for oldIE
					while ( tmp.firstChild ) {
						tmp.removeChild( tmp.firstChild );
					}

					// Remember the top-level container for proper cleanup
					tmp = safe.lastChild;
				}
			}
		}

		// Fix #11356: Clear elements from fragment
		if ( tmp ) {
			safe.removeChild( tmp );
		}

		// Reset defaultChecked for any radios and checkboxes
		// about to be appended to the DOM in IE 6/7 (#8060)
		if ( !support.appendChecked ) {
			jQuery.grep( getAll( nodes, "input" ), fixDefaultChecked );
		}

		i = 0;
		while ( (elem = nodes[ i++ ]) ) {

			// #4087 - If origin and destination elements are the same, and this is
			// that element, do not do anything
			if ( selection && jQuery.inArray( elem, selection ) !== -1 ) {
				continue;
			}

			contains = jQuery.contains( elem.ownerDocument, elem );

			// Append to fragment
			tmp = getAll( safe.appendChild( elem ), "script" );

			// Preserve script evaluation history
			if ( contains ) {
				setGlobalEval( tmp );
			}

			// Capture executables
			if ( scripts ) {
				j = 0;
				while ( (elem = tmp[ j++ ]) ) {
					if ( rscriptType.test( elem.type || "" ) ) {
						scripts.push( elem );
					}
				}
			}
		}

		tmp = null;

		return safe;
	},

	cleanData: function( elems, /* internal */ acceptData ) {
		var elem, type, id, data,
			i = 0,
			internalKey = jQuery.expando,
			cache = jQuery.cache,
			deleteExpando = support.deleteExpando,
			special = jQuery.event.special;

		for ( ; (elem = elems[i]) != null; i++ ) {
			if ( acceptData || jQuery.acceptData( elem ) ) {

				id = elem[ internalKey ];
				data = id && cache[ id ];

				if ( data ) {
					if ( data.events ) {
						for ( type in data.events ) {
							if ( special[ type ] ) {
								jQuery.event.remove( elem, type );

							// This is a shortcut to avoid jQuery.event.remove's overhead
							} else {
								jQuery.removeEvent( elem, type, data.handle );
							}
						}
					}

					// Remove cache only if it was not already removed by jQuery.event.remove
					if ( cache[ id ] ) {

						delete cache[ id ];

						// IE does not allow us to delete expando properties from nodes,
						// nor does it have a removeAttribute function on Document nodes;
						// we must handle all of these cases
						if ( deleteExpando ) {
							delete elem[ internalKey ];

						} else if ( typeof elem.removeAttribute !== strundefined ) {
							elem.removeAttribute( internalKey );

						} else {
							elem[ internalKey ] = null;
						}

						deletedIds.push( id );
					}
				}
			}
		}
	}
});

jQuery.fn.extend({
	text: function( value ) {
		return access( this, function( value ) {
			return value === undefined ?
				jQuery.text( this ) :
				this.empty().append( ( this[0] && this[0].ownerDocument || document ).createTextNode( value ) );
		}, null, value, arguments.length );
	},

	append: function() {
		return this.domManip( arguments, function( elem ) {
			if ( this.nodeType === 1 || this.nodeType === 11 || this.nodeType === 9 ) {
				var target = manipulationTarget( this, elem );
				target.appendChild( elem );
			}
		});
	},

	prepend: function() {
		return this.domManip( arguments, function( elem ) {
			if ( this.nodeType === 1 || this.nodeType === 11 || this.nodeType === 9 ) {
				var target = manipulationTarget( this, elem );
				target.insertBefore( elem, target.firstChild );
			}
		});
	},

	before: function() {
		return this.domManip( arguments, function( elem ) {
			if ( this.parentNode ) {
				this.parentNode.insertBefore( elem, this );
			}
		});
	},

	after: function() {
		return this.domManip( arguments, function( elem ) {
			if ( this.parentNode ) {
				this.parentNode.insertBefore( elem, this.nextSibling );
			}
		});
	},

	remove: function( selector, keepData /* Internal Use Only */ ) {
		var elem,
			elems = selector ? jQuery.filter( selector, this ) : this,
			i = 0;

		for ( ; (elem = elems[i]) != null; i++ ) {

			if ( !keepData && elem.nodeType === 1 ) {
				jQuery.cleanData( getAll( elem ) );
			}

			if ( elem.parentNode ) {
				if ( keepData && jQuery.contains( elem.ownerDocument, elem ) ) {
					setGlobalEval( getAll( elem, "script" ) );
				}
				elem.parentNode.removeChild( elem );
			}
		}

		return this;
	},

	empty: function() {
		var elem,
			i = 0;

		for ( ; (elem = this[i]) != null; i++ ) {
			// Remove element nodes and prevent memory leaks
			if ( elem.nodeType === 1 ) {
				jQuery.cleanData( getAll( elem, false ) );
			}

			// Remove any remaining nodes
			while ( elem.firstChild ) {
				elem.removeChild( elem.firstChild );
			}

			// If this is a select, ensure that it displays empty (#12336)
			// Support: IE<9
			if ( elem.options && jQuery.nodeName( elem, "select" ) ) {
				elem.options.length = 0;
			}
		}

		return this;
	},

	clone: function( dataAndEvents, deepDataAndEvents ) {
		dataAndEvents = dataAndEvents == null ? false : dataAndEvents;
		deepDataAndEvents = deepDataAndEvents == null ? dataAndEvents : deepDataAndEvents;

		return this.map(function() {
			return jQuery.clone( this, dataAndEvents, deepDataAndEvents );
		});
	},

	html: function( value ) {
		return access( this, function( value ) {
			var elem = this[ 0 ] || {},
				i = 0,
				l = this.length;

			if ( value === undefined ) {
				return elem.nodeType === 1 ?
					elem.innerHTML.replace( rinlinejQuery, "" ) :
					undefined;
			}

			// See if we can take a shortcut and just use innerHTML
			if ( typeof value === "string" && !rnoInnerhtml.test( value ) &&
				( support.htmlSerialize || !rnoshimcache.test( value )  ) &&
				( support.leadingWhitespace || !rleadingWhitespace.test( value ) ) &&
				!wrapMap[ (rtagName.exec( value ) || [ "", "" ])[ 1 ].toLowerCase() ] ) {

				value = value.replace( rxhtmlTag, "<$1></$2>" );

				try {
					for (; i < l; i++ ) {
						// Remove element nodes and prevent memory leaks
						elem = this[i] || {};
						if ( elem.nodeType === 1 ) {
							jQuery.cleanData( getAll( elem, false ) );
							elem.innerHTML = value;
						}
					}

					elem = 0;

				// If using innerHTML throws an exception, use the fallback method
				} catch(e) {}
			}

			if ( elem ) {
				this.empty().append( value );
			}
		}, null, value, arguments.length );
	},

	replaceWith: function() {
		var arg = arguments[ 0 ];

		// Make the changes, replacing each context element with the new content
		this.domManip( arguments, function( elem ) {
			arg = this.parentNode;

			jQuery.cleanData( getAll( this ) );

			if ( arg ) {
				arg.replaceChild( elem, this );
			}
		});

		// Force removal if there was no new content (e.g., from empty arguments)
		return arg && (arg.length || arg.nodeType) ? this : this.remove();
	},

	detach: function( selector ) {
		return this.remove( selector, true );
	},

	domManip: function( args, callback ) {

		// Flatten any nested arrays
		args = concat.apply( [], args );

		var first, node, hasScripts,
			scripts, doc, fragment,
			i = 0,
			l = this.length,
			set = this,
			iNoClone = l - 1,
			value = args[0],
			isFunction = jQuery.isFunction( value );

		// We can't cloneNode fragments that contain checked, in WebKit
		if ( isFunction ||
				( l > 1 && typeof value === "string" &&
					!support.checkClone && rchecked.test( value ) ) ) {
			return this.each(function( index ) {
				var self = set.eq( index );
				if ( isFunction ) {
					args[0] = value.call( this, index, self.html() );
				}
				self.domManip( args, callback );
			});
		}

		if ( l ) {
			fragment = jQuery.buildFragment( args, this[ 0 ].ownerDocument, false, this );
			first = fragment.firstChild;

			if ( fragment.childNodes.length === 1 ) {
				fragment = first;
			}

			if ( first ) {
				scripts = jQuery.map( getAll( fragment, "script" ), disableScript );
				hasScripts = scripts.length;

				// Use the original fragment for the last item instead of the first because it can end up
				// being emptied incorrectly in certain situations (#8070).
				for ( ; i < l; i++ ) {
					node = fragment;

					if ( i !== iNoClone ) {
						node = jQuery.clone( node, true, true );

						// Keep references to cloned scripts for later restoration
						if ( hasScripts ) {
							jQuery.merge( scripts, getAll( node, "script" ) );
						}
					}

					callback.call( this[i], node, i );
				}

				if ( hasScripts ) {
					doc = scripts[ scripts.length - 1 ].ownerDocument;

					// Reenable scripts
					jQuery.map( scripts, restoreScript );

					// Evaluate executable scripts on first document insertion
					for ( i = 0; i < hasScripts; i++ ) {
						node = scripts[ i ];
						if ( rscriptType.test( node.type || "" ) &&
							!jQuery._data( node, "globalEval" ) && jQuery.contains( doc, node ) ) {

							if ( node.src ) {
								// Optional AJAX dependency, but won't run scripts if not present
								if ( jQuery._evalUrl ) {
									jQuery._evalUrl( node.src );
								}
							} else {
								jQuery.globalEval( ( node.text || node.textContent || node.innerHTML || "" ).replace( rcleanScript, "" ) );
							}
						}
					}
				}

				// Fix #11809: Avoid leaking memory
				fragment = first = null;
			}
		}

		return this;
	}
});

jQuery.each({
	appendTo: "append",
	prependTo: "prepend",
	insertBefore: "before",
	insertAfter: "after",
	replaceAll: "replaceWith"
}, function( name, original ) {
	jQuery.fn[ name ] = function( selector ) {
		var elems,
			i = 0,
			ret = [],
			insert = jQuery( selector ),
			last = insert.length - 1;

		for ( ; i <= last; i++ ) {
			elems = i === last ? this : this.clone(true);
			jQuery( insert[i] )[ original ]( elems );

			// Modern browsers can apply jQuery collections as arrays, but oldIE needs a .get()
			push.apply( ret, elems.get() );
		}

		return this.pushStack( ret );
	};
});


var iframe,
	elemdisplay = {};

/**
 * Retrieve the actual display of a element
 * @param {String} name nodeName of the element
 * @param {Object} doc Document object
 */
// Called only from within defaultDisplay
function actualDisplay( name, doc ) {
	var style,
		elem = jQuery( doc.createElement( name ) ).appendTo( doc.body ),

		// getDefaultComputedStyle might be reliably used only on attached element
		display = window.getDefaultComputedStyle && ( style = window.getDefaultComputedStyle( elem[ 0 ] ) ) ?

			// Use of this method is a temporary fix (more like optmization) until something better comes along,
			// since it was removed from specification and supported only in FF
			style.display : jQuery.css( elem[ 0 ], "display" );

	// We don't have any data stored on the element,
	// so use "detach" method as fast way to get rid of the element
	elem.detach();

	return display;
}

/**
 * Try to determine the default display value of an element
 * @param {String} nodeName
 */
function defaultDisplay( nodeName ) {
	var doc = document,
		display = elemdisplay[ nodeName ];

	if ( !display ) {
		display = actualDisplay( nodeName, doc );

		// If the simple way fails, read from inside an iframe
		if ( display === "none" || !display ) {

			// Use the already-created iframe if possible
			iframe = (iframe || jQuery( "<iframe frameborder='0' width='0' height='0'/>" )).appendTo( doc.documentElement );

			// Always write a new HTML skeleton so Webkit and Firefox don't choke on reuse
			doc = ( iframe[ 0 ].contentWindow || iframe[ 0 ].contentDocument ).document;

			// Support: IE
			doc.write();
			doc.close();

			display = actualDisplay( nodeName, doc );
			iframe.detach();
		}

		// Store the correct default display
		elemdisplay[ nodeName ] = display;
	}

	return display;
}


(function() {
	var shrinkWrapBlocksVal;

	support.shrinkWrapBlocks = function() {
		if ( shrinkWrapBlocksVal != null ) {
			return shrinkWrapBlocksVal;
		}

		// Will be changed later if needed.
		shrinkWrapBlocksVal = false;

		// Minified: var b,c,d
		var div, body, container;

		body = document.getElementsByTagName( "body" )[ 0 ];
		if ( !body || !body.style ) {
			// Test fired too early or in an unsupported environment, exit.
			return;
		}

		// Setup
		div = document.createElement( "div" );
		container = document.createElement( "div" );
		container.style.cssText = "position:absolute;border:0;width:0;height:0;top:0;left:-9999px";
		body.appendChild( container ).appendChild( div );

		// Support: IE6
		// Check if elements with layout shrink-wrap their children
		if ( typeof div.style.zoom !== strundefined ) {
			// Reset CSS: box-sizing; display; margin; border
			div.style.cssText =
				// Support: Firefox<29, Android 2.3
				// Vendor-prefix box-sizing
				"-webkit-box-sizing:content-box;-moz-box-sizing:content-box;" +
				"box-sizing:content-box;display:block;margin:0;border:0;" +
				"padding:1px;width:1px;zoom:1";
			div.appendChild( document.createElement( "div" ) ).style.width = "5px";
			shrinkWrapBlocksVal = div.offsetWidth !== 3;
		}

		body.removeChild( container );

		return shrinkWrapBlocksVal;
	};

})();
var rmargin = (/^margin/);

var rnumnonpx = new RegExp( "^(" + pnum + ")(?!px)[a-z%]+$", "i" );



var getStyles, curCSS,
	rposition = /^(top|right|bottom|left)$/;

if ( window.getComputedStyle ) {
	getStyles = function( elem ) {
		// Support: IE<=11+, Firefox<=30+ (#15098, #14150)
		// IE throws on elements created in popups
		// FF meanwhile throws on frame elements through "defaultView.getComputedStyle"
		if ( elem.ownerDocument.defaultView.opener ) {
			return elem.ownerDocument.defaultView.getComputedStyle( elem, null );
		}

		return window.getComputedStyle( elem, null );
	};

	curCSS = function( elem, name, computed ) {
		var width, minWidth, maxWidth, ret,
			style = elem.style;

		computed = computed || getStyles( elem );

		// getPropertyValue is only needed for .css('filter') in IE9, see #12537
		ret = computed ? computed.getPropertyValue( name ) || computed[ name ] : undefined;

		if ( computed ) {

			if ( ret === "" && !jQuery.contains( elem.ownerDocument, elem ) ) {
				ret = jQuery.style( elem, name );
			}

			// A tribute to the "awesome hack by Dean Edwards"
			// Chrome < 17 and Safari 5.0 uses "computed value" instead of "used value" for margin-right
			// Safari 5.1.7 (at least) returns percentage for a larger set of values, but width seems to be reliably pixels
			// this is against the CSSOM draft spec: http://dev.w3.org/csswg/cssom/#resolved-values
			if ( rnumnonpx.test( ret ) && rmargin.test( name ) ) {

				// Remember the original values
				width = style.width;
				minWidth = style.minWidth;
				maxWidth = style.maxWidth;

				// Put in the new values to get a computed value out
				style.minWidth = style.maxWidth = style.width = ret;
				ret = computed.width;

				// Revert the changed values
				style.width = width;
				style.minWidth = minWidth;
				style.maxWidth = maxWidth;
			}
		}

		// Support: IE
		// IE returns zIndex value as an integer.
		return ret === undefined ?
			ret :
			ret + "";
	};
} else if ( document.documentElement.currentStyle ) {
	getStyles = function( elem ) {
		return elem.currentStyle;
	};

	curCSS = function( elem, name, computed ) {
		var left, rs, rsLeft, ret,
			style = elem.style;

		computed = computed || getStyles( elem );
		ret = computed ? computed[ name ] : undefined;

		// Avoid setting ret to empty string here
		// so we don't default to auto
		if ( ret == null && style && style[ name ] ) {
			ret = style[ name ];
		}

		// From the awesome hack by Dean Edwards
		// http://erik.eae.net/archives/2007/07/27/18.54.15/#comment-102291

		// If we're not dealing with a regular pixel number
		// but a number that has a weird ending, we need to convert it to pixels
		// but not position css attributes, as those are proportional to the parent element instead
		// and we can't measure the parent instead because it might trigger a "stacking dolls" problem
		if ( rnumnonpx.test( ret ) && !rposition.test( name ) ) {

			// Remember the original values
			left = style.left;
			rs = elem.runtimeStyle;
			rsLeft = rs && rs.left;

			// Put in the new values to get a computed value out
			if ( rsLeft ) {
				rs.left = elem.currentStyle.left;
			}
			style.left = name === "fontSize" ? "1em" : ret;
			ret = style.pixelLeft + "px";

			// Revert the changed values
			style.left = left;
			if ( rsLeft ) {
				rs.left = rsLeft;
			}
		}

		// Support: IE
		// IE returns zIndex value as an integer.
		return ret === undefined ?
			ret :
			ret + "" || "auto";
	};
}




function addGetHookIf( conditionFn, hookFn ) {
	// Define the hook, we'll check on the first run if it's really needed.
	return {
		get: function() {
			var condition = conditionFn();

			if ( condition == null ) {
				// The test was not ready at this point; screw the hook this time
				// but check again when needed next time.
				return;
			}

			if ( condition ) {
				// Hook not needed (or it's not possible to use it due to missing dependency),
				// remove it.
				// Since there are no other hooks for marginRight, remove the whole object.
				delete this.get;
				return;
			}

			// Hook needed; redefine it so that the support test is not executed again.

			return (this.get = hookFn).apply( this, arguments );
		}
	};
}


(function() {
	// Minified: var b,c,d,e,f,g, h,i
	var div, style, a, pixelPositionVal, boxSizingReliableVal,
		reliableHiddenOffsetsVal, reliableMarginRightVal;

	// Setup
	div = document.createElement( "div" );
	div.innerHTML = "  <link/><table></table><a href='/a'>a</a><input type='checkbox'/>";
	a = div.getElementsByTagName( "a" )[ 0 ];
	style = a && a.style;

	// Finish early in limited (non-browser) environments
	if ( !style ) {
		return;
	}

	style.cssText = "float:left;opacity:.5";

	// Support: IE<9
	// Make sure that element opacity exists (as opposed to filter)
	support.opacity = style.opacity === "0.5";

	// Verify style float existence
	// (IE uses styleFloat instead of cssFloat)
	support.cssFloat = !!style.cssFloat;

	div.style.backgroundClip = "content-box";
	div.cloneNode( true ).style.backgroundClip = "";
	support.clearCloneStyle = div.style.backgroundClip === "content-box";

	// Support: Firefox<29, Android 2.3
	// Vendor-prefix box-sizing
	support.boxSizing = style.boxSizing === "" || style.MozBoxSizing === "" ||
		style.WebkitBoxSizing === "";

	jQuery.extend(support, {
		reliableHiddenOffsets: function() {
			if ( reliableHiddenOffsetsVal == null ) {
				computeStyleTests();
			}
			return reliableHiddenOffsetsVal;
		},

		boxSizingReliable: function() {
			if ( boxSizingReliableVal == null ) {
				computeStyleTests();
			}
			return boxSizingReliableVal;
		},

		pixelPosition: function() {
			if ( pixelPositionVal == null ) {
				computeStyleTests();
			}
			return pixelPositionVal;
		},

		// Support: Android 2.3
		reliableMarginRight: function() {
			if ( reliableMarginRightVal == null ) {
				computeStyleTests();
			}
			return reliableMarginRightVal;
		}
	});

	function computeStyleTests() {
		// Minified: var b,c,d,j
		var div, body, container, contents;

		body = document.getElementsByTagName( "body" )[ 0 ];
		if ( !body || !body.style ) {
			// Test fired too early or in an unsupported environment, exit.
			return;
		}

		// Setup
		div = document.createElement( "div" );
		container = document.createElement( "div" );
		container.style.cssText = "position:absolute;border:0;width:0;height:0;top:0;left:-9999px";
		body.appendChild( container ).appendChild( div );

		div.style.cssText =
			// Support: Firefox<29, Android 2.3
			// Vendor-prefix box-sizing
			"-webkit-box-sizing:border-box;-moz-box-sizing:border-box;" +
			"box-sizing:border-box;display:block;margin-top:1%;top:1%;" +
			"border:1px;padding:1px;width:4px;position:absolute";

		// Support: IE<9
		// Assume reasonable values in the absence of getComputedStyle
		pixelPositionVal = boxSizingReliableVal = false;
		reliableMarginRightVal = true;

		// Check for getComputedStyle so that this code is not run in IE<9.
		if ( window.getComputedStyle ) {
			pixelPositionVal = ( window.getComputedStyle( div, null ) || {} ).top !== "1%";
			boxSizingReliableVal =
				( window.getComputedStyle( div, null ) || { width: "4px" } ).width === "4px";

			// Support: Android 2.3
			// Div with explicit width and no margin-right incorrectly
			// gets computed margin-right based on width of container (#3333)
			// WebKit Bug 13343 - getComputedStyle returns wrong value for margin-right
			contents = div.appendChild( document.createElement( "div" ) );

			// Reset CSS: box-sizing; display; margin; border; padding
			contents.style.cssText = div.style.cssText =
				// Support: Firefox<29, Android 2.3
				// Vendor-prefix box-sizing
				"-webkit-box-sizing:content-box;-moz-box-sizing:content-box;" +
				"box-sizing:content-box;display:block;margin:0;border:0;padding:0";
			contents.style.marginRight = contents.style.width = "0";
			div.style.width = "1px";

			reliableMarginRightVal =
				!parseFloat( ( window.getComputedStyle( contents, null ) || {} ).marginRight );

			div.removeChild( contents );
		}

		// Support: IE8
		// Check if table cells still have offsetWidth/Height when they are set
		// to display:none and there are still other visible table cells in a
		// table row; if so, offsetWidth/Height are not reliable for use when
		// determining if an element has been hidden directly using
		// display:none (it is still safe to use offsets if a parent element is
		// hidden; don safety goggles and see bug #4512 for more information).
		div.innerHTML = "<table><tr><td></td><td>t</td></tr></table>";
		contents = div.getElementsByTagName( "td" );
		contents[ 0 ].style.cssText = "margin:0;border:0;padding:0;display:none";
		reliableHiddenOffsetsVal = contents[ 0 ].offsetHeight === 0;
		if ( reliableHiddenOffsetsVal ) {
			contents[ 0 ].style.display = "";
			contents[ 1 ].style.display = "none";
			reliableHiddenOffsetsVal = contents[ 0 ].offsetHeight === 0;
		}

		body.removeChild( container );
	}

})();


// A method for quickly swapping in/out CSS properties to get correct calculations.
jQuery.swap = function( elem, options, callback, args ) {
	var ret, name,
		old = {};

	// Remember the old values, and insert the new ones
	for ( name in options ) {
		old[ name ] = elem.style[ name ];
		elem.style[ name ] = options[ name ];
	}

	ret = callback.apply( elem, args || [] );

	// Revert the old values
	for ( name in options ) {
		elem.style[ name ] = old[ name ];
	}

	return ret;
};


var
		ralpha = /alpha\([^)]*\)/i,
	ropacity = /opacity\s*=\s*([^)]*)/,

	// swappable if display is none or starts with table except "table", "table-cell", or "table-caption"
	// see here for display values: https://developer.mozilla.org/en-US/docs/CSS/display
	rdisplayswap = /^(none|table(?!-c[ea]).+)/,
	rnumsplit = new RegExp( "^(" + pnum + ")(.*)$", "i" ),
	rrelNum = new RegExp( "^([+-])=(" + pnum + ")", "i" ),

	cssShow = { position: "absolute", visibility: "hidden", display: "block" },
	cssNormalTransform = {
		letterSpacing: "0",
		fontWeight: "400"
	},

	cssPrefixes = [ "Webkit", "O", "Moz", "ms" ];


// return a css property mapped to a potentially vendor prefixed property
function vendorPropName( style, name ) {

	// shortcut for names that are not vendor prefixed
	if ( name in style ) {
		return name;
	}

	// check for vendor prefixed names
	var capName = name.charAt(0).toUpperCase() + name.slice(1),
		origName = name,
		i = cssPrefixes.length;

	while ( i-- ) {
		name = cssPrefixes[ i ] + capName;
		if ( name in style ) {
			return name;
		}
	}

	return origName;
}

function showHide( elements, show ) {
	var display, elem, hidden,
		values = [],
		index = 0,
		length = elements.length;

	for ( ; index < length; index++ ) {
		elem = elements[ index ];
		if ( !elem.style ) {
			continue;
		}

		values[ index ] = jQuery._data( elem, "olddisplay" );
		display = elem.style.display;
		if ( show ) {
			// Reset the inline display of this element to learn if it is
			// being hidden by cascaded rules or not
			if ( !values[ index ] && display === "none" ) {
				elem.style.display = "";
			}

			// Set elements which have been overridden with display: none
			// in a stylesheet to whatever the default browser style is
			// for such an element
			if ( elem.style.display === "" && isHidden( elem ) ) {
				values[ index ] = jQuery._data( elem, "olddisplay", defaultDisplay(elem.nodeName) );
			}
		} else {
			hidden = isHidden( elem );

			if ( display && display !== "none" || !hidden ) {
				jQuery._data( elem, "olddisplay", hidden ? display : jQuery.css( elem, "display" ) );
			}
		}
	}

	// Set the display of most of the elements in a second loop
	// to avoid the constant reflow
	for ( index = 0; index < length; index++ ) {
		elem = elements[ index ];
		if ( !elem.style ) {
			continue;
		}
		if ( !show || elem.style.display === "none" || elem.style.display === "" ) {
			elem.style.display = show ? values[ index ] || "" : "none";
		}
	}

	return elements;
}

function setPositiveNumber( elem, value, subtract ) {
	var matches = rnumsplit.exec( value );
	return matches ?
		// Guard against undefined "subtract", e.g., when used as in cssHooks
		Math.max( 0, matches[ 1 ] - ( subtract || 0 ) ) + ( matches[ 2 ] || "px" ) :
		value;
}

function augmentWidthOrHeight( elem, name, extra, isBorderBox, styles ) {
	var i = extra === ( isBorderBox ? "border" : "content" ) ?
		// If we already have the right measurement, avoid augmentation
		4 :
		// Otherwise initialize for horizontal or vertical properties
		name === "width" ? 1 : 0,

		val = 0;

	for ( ; i < 4; i += 2 ) {
		// both box models exclude margin, so add it if we want it
		if ( extra === "margin" ) {
			val += jQuery.css( elem, extra + cssExpand[ i ], true, styles );
		}

		if ( isBorderBox ) {
			// border-box includes padding, so remove it if we want content
			if ( extra === "content" ) {
				val -= jQuery.css( elem, "padding" + cssExpand[ i ], true, styles );
			}

			// at this point, extra isn't border nor margin, so remove border
			if ( extra !== "margin" ) {
				val -= jQuery.css( elem, "border" + cssExpand[ i ] + "Width", true, styles );
			}
		} else {
			// at this point, extra isn't content, so add padding
			val += jQuery.css( elem, "padding" + cssExpand[ i ], true, styles );

			// at this point, extra isn't content nor padding, so add border
			if ( extra !== "padding" ) {
				val += jQuery.css( elem, "border" + cssExpand[ i ] + "Width", true, styles );
			}
		}
	}

	return val;
}

function getWidthOrHeight( elem, name, extra ) {

	// Start with offset property, which is equivalent to the border-box value
	var valueIsBorderBox = true,
		val = name === "width" ? elem.offsetWidth : elem.offsetHeight,
		styles = getStyles( elem ),
		isBorderBox = support.boxSizing && jQuery.css( elem, "boxSizing", false, styles ) === "border-box";

	// some non-html elements return undefined for offsetWidth, so check for null/undefined
	// svg - https://bugzilla.mozilla.org/show_bug.cgi?id=649285
	// MathML - https://bugzilla.mozilla.org/show_bug.cgi?id=491668
	if ( val <= 0 || val == null ) {
		// Fall back to computed then uncomputed css if necessary
		val = curCSS( elem, name, styles );
		if ( val < 0 || val == null ) {
			val = elem.style[ name ];
		}

		// Computed unit is not pixels. Stop here and return.
		if ( rnumnonpx.test(val) ) {
			return val;
		}

		// we need the check for style in case a browser which returns unreliable values
		// for getComputedStyle silently falls back to the reliable elem.style
		valueIsBorderBox = isBorderBox && ( support.boxSizingReliable() || val === elem.style[ name ] );

		// Normalize "", auto, and prepare for extra
		val = parseFloat( val ) || 0;
	}

	// use the active box-sizing model to add/subtract irrelevant styles
	return ( val +
		augmentWidthOrHeight(
			elem,
			name,
			extra || ( isBorderBox ? "border" : "content" ),
			valueIsBorderBox,
			styles
		)
	) + "px";
}

jQuery.extend({
	// Add in style property hooks for overriding the default
	// behavior of getting and setting a style property
	cssHooks: {
		opacity: {
			get: function( elem, computed ) {
				if ( computed ) {
					// We should always get a number back from opacity
					var ret = curCSS( elem, "opacity" );
					return ret === "" ? "1" : ret;
				}
			}
		}
	},

	// Don't automatically add "px" to these possibly-unitless properties
	cssNumber: {
		"columnCount": true,
		"fillOpacity": true,
		"flexGrow": true,
		"flexShrink": true,
		"fontWeight": true,
		"lineHeight": true,
		"opacity": true,
		"order": true,
		"orphans": true,
		"widows": true,
		"zIndex": true,
		"zoom": true
	},

	// Add in properties whose names you wish to fix before
	// setting or getting the value
	cssProps: {
		// normalize float css property
		"float": support.cssFloat ? "cssFloat" : "styleFloat"
	},

	// Get and set the style property on a DOM Node
	style: function( elem, name, value, extra ) {
		// Don't set styles on text and comment nodes
		if ( !elem || elem.nodeType === 3 || elem.nodeType === 8 || !elem.style ) {
			return;
		}

		// Make sure that we're working with the right name
		var ret, type, hooks,
			origName = jQuery.camelCase( name ),
			style = elem.style;

		name = jQuery.cssProps[ origName ] || ( jQuery.cssProps[ origName ] = vendorPropName( style, origName ) );

		// gets hook for the prefixed version
		// followed by the unprefixed version
		hooks = jQuery.cssHooks[ name ] || jQuery.cssHooks[ origName ];

		// Check if we're setting a value
		if ( value !== undefined ) {
			type = typeof value;

			// convert relative number strings (+= or -=) to relative numbers. #7345
			if ( type === "string" && (ret = rrelNum.exec( value )) ) {
				value = ( ret[1] + 1 ) * ret[2] + parseFloat( jQuery.css( elem, name ) );
				// Fixes bug #9237
				type = "number";
			}

			// Make sure that null and NaN values aren't set. See: #7116
			if ( value == null || value !== value ) {
				return;
			}

			// If a number was passed in, add 'px' to the (except for certain CSS properties)
			if ( type === "number" && !jQuery.cssNumber[ origName ] ) {
				value += "px";
			}

			// Fixes #8908, it can be done more correctly by specifing setters in cssHooks,
			// but it would mean to define eight (for every problematic property) identical functions
			if ( !support.clearCloneStyle && value === "" && name.indexOf("background") === 0 ) {
				style[ name ] = "inherit";
			}

			// If a hook was provided, use that value, otherwise just set the specified value
			if ( !hooks || !("set" in hooks) || (value = hooks.set( elem, value, extra )) !== undefined ) {

				// Support: IE
				// Swallow errors from 'invalid' CSS values (#5509)
				try {
					style[ name ] = value;
				} catch(e) {}
			}

		} else {
			// If a hook was provided get the non-computed value from there
			if ( hooks && "get" in hooks && (ret = hooks.get( elem, false, extra )) !== undefined ) {
				return ret;
			}

			// Otherwise just get the value from the style object
			return style[ name ];
		}
	},

	css: function( elem, name, extra, styles ) {
		var num, val, hooks,
			origName = jQuery.camelCase( name );

		// Make sure that we're working with the right name
		name = jQuery.cssProps[ origName ] || ( jQuery.cssProps[ origName ] = vendorPropName( elem.style, origName ) );

		// gets hook for the prefixed version
		// followed by the unprefixed version
		hooks = jQuery.cssHooks[ name ] || jQuery.cssHooks[ origName ];

		// If a hook was provided get the computed value from there
		if ( hooks && "get" in hooks ) {
			val = hooks.get( elem, true, extra );
		}

		// Otherwise, if a way to get the computed value exists, use that
		if ( val === undefined ) {
			val = curCSS( elem, name, styles );
		}

		//convert "normal" to computed value
		if ( val === "normal" && name in cssNormalTransform ) {
			val = cssNormalTransform[ name ];
		}

		// Return, converting to number if forced or a qualifier was provided and val looks numeric
		if ( extra === "" || extra ) {
			num = parseFloat( val );
			return extra === true || jQuery.isNumeric( num ) ? num || 0 : val;
		}
		return val;
	}
});

jQuery.each([ "height", "width" ], function( i, name ) {
	jQuery.cssHooks[ name ] = {
		get: function( elem, computed, extra ) {
			if ( computed ) {
				// certain elements can have dimension info if we invisibly show them
				// however, it must have a current display style that would benefit from this
				return rdisplayswap.test( jQuery.css( elem, "display" ) ) && elem.offsetWidth === 0 ?
					jQuery.swap( elem, cssShow, function() {
						return getWidthOrHeight( elem, name, extra );
					}) :
					getWidthOrHeight( elem, name, extra );
			}
		},

		set: function( elem, value, extra ) {
			var styles = extra && getStyles( elem );
			return setPositiveNumber( elem, value, extra ?
				augmentWidthOrHeight(
					elem,
					name,
					extra,
					support.boxSizing && jQuery.css( elem, "boxSizing", false, styles ) === "border-box",
					styles
				) : 0
			);
		}
	};
});

if ( !support.opacity ) {
	jQuery.cssHooks.opacity = {
		get: function( elem, computed ) {
			// IE uses filters for opacity
			return ropacity.test( (computed && elem.currentStyle ? elem.currentStyle.filter : elem.style.filter) || "" ) ?
				( 0.01 * parseFloat( RegExp.$1 ) ) + "" :
				computed ? "1" : "";
		},

		set: function( elem, value ) {
			var style = elem.style,
				currentStyle = elem.currentStyle,
				opacity = jQuery.isNumeric( value ) ? "alpha(opacity=" + value * 100 + ")" : "",
				filter = currentStyle && currentStyle.filter || style.filter || "";

			// IE has trouble with opacity if it does not have layout
			// Force it by setting the zoom level
			style.zoom = 1;

			// if setting opacity to 1, and no other filters exist - attempt to remove filter attribute #6652
			// if value === "", then remove inline opacity #12685
			if ( ( value >= 1 || value === "" ) &&
					jQuery.trim( filter.replace( ralpha, "" ) ) === "" &&
					style.removeAttribute ) {

				// Setting style.filter to null, "" & " " still leave "filter:" in the cssText
				// if "filter:" is present at all, clearType is disabled, we want to avoid this
				// style.removeAttribute is IE Only, but so apparently is this code path...
				style.removeAttribute( "filter" );

				// if there is no filter style applied in a css rule or unset inline opacity, we are done
				if ( value === "" || currentStyle && !currentStyle.filter ) {
					return;
				}
			}

			// otherwise, set new filter values
			style.filter = ralpha.test( filter ) ?
				filter.replace( ralpha, opacity ) :
				filter + " " + opacity;
		}
	};
}

jQuery.cssHooks.marginRight = addGetHookIf( support.reliableMarginRight,
	function( elem, computed ) {
		if ( computed ) {
			// WebKit Bug 13343 - getComputedStyle returns wrong value for margin-right
			// Work around by temporarily setting element display to inline-block
			return jQuery.swap( elem, { "display": "inline-block" },
				curCSS, [ elem, "marginRight" ] );
		}
	}
);

// These hooks are used by animate to expand properties
jQuery.each({
	margin: "",
	padding: "",
	border: "Width"
}, function( prefix, suffix ) {
	jQuery.cssHooks[ prefix + suffix ] = {
		expand: function( value ) {
			var i = 0,
				expanded = {},

				// assumes a single number if not a string
				parts = typeof value === "string" ? value.split(" ") : [ value ];

			for ( ; i < 4; i++ ) {
				expanded[ prefix + cssExpand[ i ] + suffix ] =
					parts[ i ] || parts[ i - 2 ] || parts[ 0 ];
			}

			return expanded;
		}
	};

	if ( !rmargin.test( prefix ) ) {
		jQuery.cssHooks[ prefix + suffix ].set = setPositiveNumber;
	}
});

jQuery.fn.extend({
	css: function( name, value ) {
		return access( this, function( elem, name, value ) {
			var styles, len,
				map = {},
				i = 0;

			if ( jQuery.isArray( name ) ) {
				styles = getStyles( elem );
				len = name.length;

				for ( ; i < len; i++ ) {
					map[ name[ i ] ] = jQuery.css( elem, name[ i ], false, styles );
				}

				return map;
			}

			return value !== undefined ?
				jQuery.style( elem, name, value ) :
				jQuery.css( elem, name );
		}, name, value, arguments.length > 1 );
	},
	show: function() {
		return showHide( this, true );
	},
	hide: function() {
		return showHide( this );
	},
	toggle: function( state ) {
		if ( typeof state === "boolean" ) {
			return state ? this.show() : this.hide();
		}

		return this.each(function() {
			if ( isHidden( this ) ) {
				jQuery( this ).show();
			} else {
				jQuery( this ).hide();
			}
		});
	}
});


function Tween( elem, options, prop, end, easing ) {
	return new Tween.prototype.init( elem, options, prop, end, easing );
}
jQuery.Tween = Tween;

Tween.prototype = {
	constructor: Tween,
	init: function( elem, options, prop, end, easing, unit ) {
		this.elem = elem;
		this.prop = prop;
		this.easing = easing || "swing";
		this.options = options;
		this.start = this.now = this.cur();
		this.end = end;
		this.unit = unit || ( jQuery.cssNumber[ prop ] ? "" : "px" );
	},
	cur: function() {
		var hooks = Tween.propHooks[ this.prop ];

		return hooks && hooks.get ?
			hooks.get( this ) :
			Tween.propHooks._default.get( this );
	},
	run: function( percent ) {
		var eased,
			hooks = Tween.propHooks[ this.prop ];

		if ( this.options.duration ) {
			this.pos = eased = jQuery.easing[ this.easing ](
				percent, this.options.duration * percent, 0, 1, this.options.duration
			);
		} else {
			this.pos = eased = percent;
		}
		this.now = ( this.end - this.start ) * eased + this.start;

		if ( this.options.step ) {
			this.options.step.call( this.elem, this.now, this );
		}

		if ( hooks && hooks.set ) {
			hooks.set( this );
		} else {
			Tween.propHooks._default.set( this );
		}
		return this;
	}
};

Tween.prototype.init.prototype = Tween.prototype;

Tween.propHooks = {
	_default: {
		get: function( tween ) {
			var result;

			if ( tween.elem[ tween.prop ] != null &&
				(!tween.elem.style || tween.elem.style[ tween.prop ] == null) ) {
				return tween.elem[ tween.prop ];
			}

			// passing an empty string as a 3rd parameter to .css will automatically
			// attempt a parseFloat and fallback to a string if the parse fails
			// so, simple values such as "10px" are parsed to Float.
			// complex values such as "rotate(1rad)" are returned as is.
			result = jQuery.css( tween.elem, tween.prop, "" );
			// Empty strings, null, undefined and "auto" are converted to 0.
			return !result || result === "auto" ? 0 : result;
		},
		set: function( tween ) {
			// use step hook for back compat - use cssHook if its there - use .style if its
			// available and use plain properties where available
			if ( jQuery.fx.step[ tween.prop ] ) {
				jQuery.fx.step[ tween.prop ]( tween );
			} else if ( tween.elem.style && ( tween.elem.style[ jQuery.cssProps[ tween.prop ] ] != null || jQuery.cssHooks[ tween.prop ] ) ) {
				jQuery.style( tween.elem, tween.prop, tween.now + tween.unit );
			} else {
				tween.elem[ tween.prop ] = tween.now;
			}
		}
	}
};

// Support: IE <=9
// Panic based approach to setting things on disconnected nodes

Tween.propHooks.scrollTop = Tween.propHooks.scrollLeft = {
	set: function( tween ) {
		if ( tween.elem.nodeType && tween.elem.parentNode ) {
			tween.elem[ tween.prop ] = tween.now;
		}
	}
};

jQuery.easing = {
	linear: function( p ) {
		return p;
	},
	swing: function( p ) {
		return 0.5 - Math.cos( p * Math.PI ) / 2;
	}
};

jQuery.fx = Tween.prototype.init;

// Back Compat <1.8 extension point
jQuery.fx.step = {};




var
	fxNow, timerId,
	rfxtypes = /^(?:toggle|show|hide)$/,
	rfxnum = new RegExp( "^(?:([+-])=|)(" + pnum + ")([a-z%]*)$", "i" ),
	rrun = /queueHooks$/,
	animationPrefilters = [ defaultPrefilter ],
	tweeners = {
		"*": [ function( prop, value ) {
			var tween = this.createTween( prop, value ),
				target = tween.cur(),
				parts = rfxnum.exec( value ),
				unit = parts && parts[ 3 ] || ( jQuery.cssNumber[ prop ] ? "" : "px" ),

				// Starting value computation is required for potential unit mismatches
				start = ( jQuery.cssNumber[ prop ] || unit !== "px" && +target ) &&
					rfxnum.exec( jQuery.css( tween.elem, prop ) ),
				scale = 1,
				maxIterations = 20;

			if ( start && start[ 3 ] !== unit ) {
				// Trust units reported by jQuery.css
				unit = unit || start[ 3 ];

				// Make sure we update the tween properties later on
				parts = parts || [];

				// Iteratively approximate from a nonzero starting point
				start = +target || 1;

				do {
					// If previous iteration zeroed out, double until we get *something*
					// Use a string for doubling factor so we don't accidentally see scale as unchanged below
					scale = scale || ".5";

					// Adjust and apply
					start = start / scale;
					jQuery.style( tween.elem, prop, start + unit );

				// Update scale, tolerating zero or NaN from tween.cur()
				// And breaking the loop if scale is unchanged or perfect, or if we've just had enough
				} while ( scale !== (scale = tween.cur() / target) && scale !== 1 && --maxIterations );
			}

			// Update tween properties
			if ( parts ) {
				start = tween.start = +start || +target || 0;
				tween.unit = unit;
				// If a +=/-= token was provided, we're doing a relative animation
				tween.end = parts[ 1 ] ?
					start + ( parts[ 1 ] + 1 ) * parts[ 2 ] :
					+parts[ 2 ];
			}

			return tween;
		} ]
	};

// Animations created synchronously will run synchronously
function createFxNow() {
	setTimeout(function() {
		fxNow = undefined;
	});
	return ( fxNow = jQuery.now() );
}

// Generate parameters to create a standard animation
function genFx( type, includeWidth ) {
	var which,
		attrs = { height: type },
		i = 0;

	// if we include width, step value is 1 to do all cssExpand values,
	// if we don't include width, step value is 2 to skip over Left and Right
	includeWidth = includeWidth ? 1 : 0;
	for ( ; i < 4 ; i += 2 - includeWidth ) {
		which = cssExpand[ i ];
		attrs[ "margin" + which ] = attrs[ "padding" + which ] = type;
	}

	if ( includeWidth ) {
		attrs.opacity = attrs.width = type;
	}

	return attrs;
}

function createTween( value, prop, animation ) {
	var tween,
		collection = ( tweeners[ prop ] || [] ).concat( tweeners[ "*" ] ),
		index = 0,
		length = collection.length;
	for ( ; index < length; index++ ) {
		if ( (tween = collection[ index ].call( animation, prop, value )) ) {

			// we're done with this property
			return tween;
		}
	}
}

function defaultPrefilter( elem, props, opts ) {
	/* jshint validthis: true */
	var prop, value, toggle, tween, hooks, oldfire, display, checkDisplay,
		anim = this,
		orig = {},
		style = elem.style,
		hidden = elem.nodeType && isHidden( elem ),
		dataShow = jQuery._data( elem, "fxshow" );

	// handle queue: false promises
	if ( !opts.queue ) {
		hooks = jQuery._queueHooks( elem, "fx" );
		if ( hooks.unqueued == null ) {
			hooks.unqueued = 0;
			oldfire = hooks.empty.fire;
			hooks.empty.fire = function() {
				if ( !hooks.unqueued ) {
					oldfire();
				}
			};
		}
		hooks.unqueued++;

		anim.always(function() {
			// doing this makes sure that the complete handler will be called
			// before this completes
			anim.always(function() {
				hooks.unqueued--;
				if ( !jQuery.queue( elem, "fx" ).length ) {
					hooks.empty.fire();
				}
			});
		});
	}

	// height/width overflow pass
	if ( elem.nodeType === 1 && ( "height" in props || "width" in props ) ) {
		// Make sure that nothing sneaks out
		// Record all 3 overflow attributes because IE does not
		// change the overflow attribute when overflowX and
		// overflowY are set to the same value
		opts.overflow = [ style.overflow, style.overflowX, style.overflowY ];

		// Set display property to inline-block for height/width
		// animations on inline elements that are having width/height animated
		display = jQuery.css( elem, "display" );

		// Test default display if display is currently "none"
		checkDisplay = display === "none" ?
			jQuery._data( elem, "olddisplay" ) || defaultDisplay( elem.nodeName ) : display;

		if ( checkDisplay === "inline" && jQuery.css( elem, "float" ) === "none" ) {

			// inline-level elements accept inline-block;
			// block-level elements need to be inline with layout
			if ( !support.inlineBlockNeedsLayout || defaultDisplay( elem.nodeName ) === "inline" ) {
				style.display = "inline-block";
			} else {
				style.zoom = 1;
			}
		}
	}

	if ( opts.overflow ) {
		style.overflow = "hidden";
		if ( !support.shrinkWrapBlocks() ) {
			anim.always(function() {
				style.overflow = opts.overflow[ 0 ];
				style.overflowX = opts.overflow[ 1 ];
				style.overflowY = opts.overflow[ 2 ];
			});
		}
	}

	// show/hide pass
	for ( prop in props ) {
		value = props[ prop ];
		if ( rfxtypes.exec( value ) ) {
			delete props[ prop ];
			toggle = toggle || value === "toggle";
			if ( value === ( hidden ? "hide" : "show" ) ) {

				// If there is dataShow left over from a stopped hide or show and we are going to proceed with show, we should pretend to be hidden
				if ( value === "show" && dataShow && dataShow[ prop ] !== undefined ) {
					hidden = true;
				} else {
					continue;
				}
			}
			orig[ prop ] = dataShow && dataShow[ prop ] || jQuery.style( elem, prop );

		// Any non-fx value stops us from restoring the original display value
		} else {
			display = undefined;
		}
	}

	if ( !jQuery.isEmptyObject( orig ) ) {
		if ( dataShow ) {
			if ( "hidden" in dataShow ) {
				hidden = dataShow.hidden;
			}
		} else {
			dataShow = jQuery._data( elem, "fxshow", {} );
		}

		// store state if its toggle - enables .stop().toggle() to "reverse"
		if ( toggle ) {
			dataShow.hidden = !hidden;
		}
		if ( hidden ) {
			jQuery( elem ).show();
		} else {
			anim.done(function() {
				jQuery( elem ).hide();
			});
		}
		anim.done(function() {
			var prop;
			jQuery._removeData( elem, "fxshow" );
			for ( prop in orig ) {
				jQuery.style( elem, prop, orig[ prop ] );
			}
		});
		for ( prop in orig ) {
			tween = createTween( hidden ? dataShow[ prop ] : 0, prop, anim );

			if ( !( prop in dataShow ) ) {
				dataShow[ prop ] = tween.start;
				if ( hidden ) {
					tween.end = tween.start;
					tween.start = prop === "width" || prop === "height" ? 1 : 0;
				}
			}
		}

	// If this is a noop like .hide().hide(), restore an overwritten display value
	} else if ( (display === "none" ? defaultDisplay( elem.nodeName ) : display) === "inline" ) {
		style.display = display;
	}
}

function propFilter( props, specialEasing ) {
	var index, name, easing, value, hooks;

	// camelCase, specialEasing and expand cssHook pass
	for ( index in props ) {
		name = jQuery.camelCase( index );
		easing = specialEasing[ name ];
		value = props[ index ];
		if ( jQuery.isArray( value ) ) {
			easing = value[ 1 ];
			value = props[ index ] = value[ 0 ];
		}

		if ( index !== name ) {
			props[ name ] = value;
			delete props[ index ];
		}

		hooks = jQuery.cssHooks[ name ];
		if ( hooks && "expand" in hooks ) {
			value = hooks.expand( value );
			delete props[ name ];

			// not quite $.extend, this wont overwrite keys already present.
			// also - reusing 'index' from above because we have the correct "name"
			for ( index in value ) {
				if ( !( index in props ) ) {
					props[ index ] = value[ index ];
					specialEasing[ index ] = easing;
				}
			}
		} else {
			specialEasing[ name ] = easing;
		}
	}
}

function Animation( elem, properties, options ) {
	var result,
		stopped,
		index = 0,
		length = animationPrefilters.length,
		deferred = jQuery.Deferred().always( function() {
			// don't match elem in the :animated selector
			delete tick.elem;
		}),
		tick = function() {
			if ( stopped ) {
				return false;
			}
			var currentTime = fxNow || createFxNow(),
				remaining = Math.max( 0, animation.startTime + animation.duration - currentTime ),
				// archaic crash bug won't allow us to use 1 - ( 0.5 || 0 ) (#12497)
				temp = remaining / animation.duration || 0,
				percent = 1 - temp,
				index = 0,
				length = animation.tweens.length;

			for ( ; index < length ; index++ ) {
				animation.tweens[ index ].run( percent );
			}

			deferred.notifyWith( elem, [ animation, percent, remaining ]);

			if ( percent < 1 && length ) {
				return remaining;
			} else {
				deferred.resolveWith( elem, [ animation ] );
				return false;
			}
		},
		animation = deferred.promise({
			elem: elem,
			props: jQuery.extend( {}, properties ),
			opts: jQuery.extend( true, { specialEasing: {} }, options ),
			originalProperties: properties,
			originalOptions: options,
			startTime: fxNow || createFxNow(),
			duration: options.duration,
			tweens: [],
			createTween: function( prop, end ) {
				var tween = jQuery.Tween( elem, animation.opts, prop, end,
						animation.opts.specialEasing[ prop ] || animation.opts.easing );
				animation.tweens.push( tween );
				return tween;
			},
			stop: function( gotoEnd ) {
				var index = 0,
					// if we are going to the end, we want to run all the tweens
					// otherwise we skip this part
					length = gotoEnd ? animation.tweens.length : 0;
				if ( stopped ) {
					return this;
				}
				stopped = true;
				for ( ; index < length ; index++ ) {
					animation.tweens[ index ].run( 1 );
				}

				// resolve when we played the last frame
				// otherwise, reject
				if ( gotoEnd ) {
					deferred.resolveWith( elem, [ animation, gotoEnd ] );
				} else {
					deferred.rejectWith( elem, [ animation, gotoEnd ] );
				}
				return this;
			}
		}),
		props = animation.props;

	propFilter( props, animation.opts.specialEasing );

	for ( ; index < length ; index++ ) {
		result = animationPrefilters[ index ].call( animation, elem, props, animation.opts );
		if ( result ) {
			return result;
		}
	}

	jQuery.map( props, createTween, animation );

	if ( jQuery.isFunction( animation.opts.start ) ) {
		animation.opts.start.call( elem, animation );
	}

	jQuery.fx.timer(
		jQuery.extend( tick, {
			elem: elem,
			anim: animation,
			queue: animation.opts.queue
		})
	);

	// attach callbacks from options
	return animation.progress( animation.opts.progress )
		.done( animation.opts.done, animation.opts.complete )
		.fail( animation.opts.fail )
		.always( animation.opts.always );
}

jQuery.Animation = jQuery.extend( Animation, {
	tweener: function( props, callback ) {
		if ( jQuery.isFunction( props ) ) {
			callback = props;
			props = [ "*" ];
		} else {
			props = props.split(" ");
		}

		var prop,
			index = 0,
			length = props.length;

		for ( ; index < length ; index++ ) {
			prop = props[ index ];
			tweeners[ prop ] = tweeners[ prop ] || [];
			tweeners[ prop ].unshift( callback );
		}
	},

	prefilter: function( callback, prepend ) {
		if ( prepend ) {
			animationPrefilters.unshift( callback );
		} else {
			animationPrefilters.push( callback );
		}
	}
});

jQuery.speed = function( speed, easing, fn ) {
	var opt = speed && typeof speed === "object" ? jQuery.extend( {}, speed ) : {
		complete: fn || !fn && easing ||
			jQuery.isFunction( speed ) && speed,
		duration: speed,
		easing: fn && easing || easing && !jQuery.isFunction( easing ) && easing
	};

	opt.duration = jQuery.fx.off ? 0 : typeof opt.duration === "number" ? opt.duration :
		opt.duration in jQuery.fx.speeds ? jQuery.fx.speeds[ opt.duration ] : jQuery.fx.speeds._default;

	// normalize opt.queue - true/undefined/null -> "fx"
	if ( opt.queue == null || opt.queue === true ) {
		opt.queue = "fx";
	}

	// Queueing
	opt.old = opt.complete;

	opt.complete = function() {
		if ( jQuery.isFunction( opt.old ) ) {
			opt.old.call( this );
		}

		if ( opt.queue ) {
			jQuery.dequeue( this, opt.queue );
		}
	};

	return opt;
};

jQuery.fn.extend({
	fadeTo: function( speed, to, easing, callback ) {

		// show any hidden elements after setting opacity to 0
		return this.filter( isHidden ).css( "opacity", 0 ).show()

			// animate to the value specified
			.end().animate({ opacity: to }, speed, easing, callback );
	},
	animate: function( prop, speed, easing, callback ) {
		var empty = jQuery.isEmptyObject( prop ),
			optall = jQuery.speed( speed, easing, callback ),
			doAnimation = function() {
				// Operate on a copy of prop so per-property easing won't be lost
				var anim = Animation( this, jQuery.extend( {}, prop ), optall );

				// Empty animations, or finishing resolves immediately
				if ( empty || jQuery._data( this, "finish" ) ) {
					anim.stop( true );
				}
			};
			doAnimation.finish = doAnimation;

		return empty || optall.queue === false ?
			this.each( doAnimation ) :
			this.queue( optall.queue, doAnimation );
	},
	stop: function( type, clearQueue, gotoEnd ) {
		var stopQueue = function( hooks ) {
			var stop = hooks.stop;
			delete hooks.stop;
			stop( gotoEnd );
		};

		if ( typeof type !== "string" ) {
			gotoEnd = clearQueue;
			clearQueue = type;
			type = undefined;
		}
		if ( clearQueue && type !== false ) {
			this.queue( type || "fx", [] );
		}

		return this.each(function() {
			var dequeue = true,
				index = type != null && type + "queueHooks",
				timers = jQuery.timers,
				data = jQuery._data( this );

			if ( index ) {
				if ( data[ index ] && data[ index ].stop ) {
					stopQueue( data[ index ] );
				}
			} else {
				for ( index in data ) {
					if ( data[ index ] && data[ index ].stop && rrun.test( index ) ) {
						stopQueue( data[ index ] );
					}
				}
			}

			for ( index = timers.length; index--; ) {
				if ( timers[ index ].elem === this && (type == null || timers[ index ].queue === type) ) {
					timers[ index ].anim.stop( gotoEnd );
					dequeue = false;
					timers.splice( index, 1 );
				}
			}

			// start the next in the queue if the last step wasn't forced
			// timers currently will call their complete callbacks, which will dequeue
			// but only if they were gotoEnd
			if ( dequeue || !gotoEnd ) {
				jQuery.dequeue( this, type );
			}
		});
	},
	finish: function( type ) {
		if ( type !== false ) {
			type = type || "fx";
		}
		return this.each(function() {
			var index,
				data = jQuery._data( this ),
				queue = data[ type + "queue" ],
				hooks = data[ type + "queueHooks" ],
				timers = jQuery.timers,
				length = queue ? queue.length : 0;

			// enable finishing flag on private data
			data.finish = true;

			// empty the queue first
			jQuery.queue( this, type, [] );

			if ( hooks && hooks.stop ) {
				hooks.stop.call( this, true );
			}

			// look for any active animations, and finish them
			for ( index = timers.length; index--; ) {
				if ( timers[ index ].elem === this && timers[ index ].queue === type ) {
					timers[ index ].anim.stop( true );
					timers.splice( index, 1 );
				}
			}

			// look for any animations in the old queue and finish them
			for ( index = 0; index < length; index++ ) {
				if ( queue[ index ] && queue[ index ].finish ) {
					queue[ index ].finish.call( this );
				}
			}

			// turn off finishing flag
			delete data.finish;
		});
	}
});

jQuery.each([ "toggle", "show", "hide" ], function( i, name ) {
	var cssFn = jQuery.fn[ name ];
	jQuery.fn[ name ] = function( speed, easing, callback ) {
		return speed == null || typeof speed === "boolean" ?
			cssFn.apply( this, arguments ) :
			this.animate( genFx( name, true ), speed, easing, callback );
	};
});

// Generate shortcuts for custom animations
jQuery.each({
	slideDown: genFx("show"),
	slideUp: genFx("hide"),
	slideToggle: genFx("toggle"),
	fadeIn: { opacity: "show" },
	fadeOut: { opacity: "hide" },
	fadeToggle: { opacity: "toggle" }
}, function( name, props ) {
	jQuery.fn[ name ] = function( speed, easing, callback ) {
		return this.animate( props, speed, easing, callback );
	};
});

jQuery.timers = [];
jQuery.fx.tick = function() {
	var timer,
		timers = jQuery.timers,
		i = 0;

	fxNow = jQuery.now();

	for ( ; i < timers.length; i++ ) {
		timer = timers[ i ];
		// Checks the timer has not already been removed
		if ( !timer() && timers[ i ] === timer ) {
			timers.splice( i--, 1 );
		}
	}

	if ( !timers.length ) {
		jQuery.fx.stop();
	}
	fxNow = undefined;
};

jQuery.fx.timer = function( timer ) {
	jQuery.timers.push( timer );
	if ( timer() ) {
		jQuery.fx.start();
	} else {
		jQuery.timers.pop();
	}
};

jQuery.fx.interval = 13;

jQuery.fx.start = function() {
	if ( !timerId ) {
		timerId = setInterval( jQuery.fx.tick, jQuery.fx.interval );
	}
};

jQuery.fx.stop = function() {
	clearInterval( timerId );
	timerId = null;
};

jQuery.fx.speeds = {
	slow: 600,
	fast: 200,
	// Default speed
	_default: 400
};


// Based off of the plugin by Clint Helfers, with permission.
// http://blindsignals.com/index.php/2009/07/jquery-delay/
jQuery.fn.delay = function( time, type ) {
	time = jQuery.fx ? jQuery.fx.speeds[ time ] || time : time;
	type = type || "fx";

	return this.queue( type, function( next, hooks ) {
		var timeout = setTimeout( next, time );
		hooks.stop = function() {
			clearTimeout( timeout );
		};
	});
};


(function() {
	// Minified: var a,b,c,d,e
	var input, div, select, a, opt;

	// Setup
	div = document.createElement( "div" );
	div.setAttribute( "className", "t" );
	div.innerHTML = "  <link/><table></table><a href='/a'>a</a><input type='checkbox'/>";
	a = div.getElementsByTagName("a")[ 0 ];

	// First batch of tests.
	select = document.createElement("select");
	opt = select.appendChild( document.createElement("option") );
	input = div.getElementsByTagName("input")[ 0 ];

	a.style.cssText = "top:1px";

	// Test setAttribute on camelCase class. If it works, we need attrFixes when doing get/setAttribute (ie6/7)
	support.getSetAttribute = div.className !== "t";

	// Get the style information from getAttribute
	// (IE uses .cssText instead)
	support.style = /top/.test( a.getAttribute("style") );

	// Make sure that URLs aren't manipulated
	// (IE normalizes it by default)
	support.hrefNormalized = a.getAttribute("href") === "/a";

	// Check the default checkbox/radio value ("" on WebKit; "on" elsewhere)
	support.checkOn = !!input.value;

	// Make sure that a selected-by-default option has a working selected property.
	// (WebKit defaults to false instead of true, IE too, if it's in an optgroup)
	support.optSelected = opt.selected;

	// Tests for enctype support on a form (#6743)
	support.enctype = !!document.createElement("form").enctype;

	// Make sure that the options inside disabled selects aren't marked as disabled
	// (WebKit marks them as disabled)
	select.disabled = true;
	support.optDisabled = !opt.disabled;

	// Support: IE8 only
	// Check if we can trust getAttribute("value")
	input = document.createElement( "input" );
	input.setAttribute( "value", "" );
	support.input = input.getAttribute( "value" ) === "";

	// Check if an input maintains its value after becoming a radio
	input.value = "t";
	input.setAttribute( "type", "radio" );
	support.radioValue = input.value === "t";
})();


var rreturn = /\r/g;

jQuery.fn.extend({
	val: function( value ) {
		var hooks, ret, isFunction,
			elem = this[0];

		if ( !arguments.length ) {
			if ( elem ) {
				hooks = jQuery.valHooks[ elem.type ] || jQuery.valHooks[ elem.nodeName.toLowerCase() ];

				if ( hooks && "get" in hooks && (ret = hooks.get( elem, "value" )) !== undefined ) {
					return ret;
				}

				ret = elem.value;

				return typeof ret === "string" ?
					// handle most common string cases
					ret.replace(rreturn, "") :
					// handle cases where value is null/undef or number
					ret == null ? "" : ret;
			}

			return;
		}

		isFunction = jQuery.isFunction( value );

		return this.each(function( i ) {
			var val;

			if ( this.nodeType !== 1 ) {
				return;
			}

			if ( isFunction ) {
				val = value.call( this, i, jQuery( this ).val() );
			} else {
				val = value;
			}

			// Treat null/undefined as ""; convert numbers to string
			if ( val == null ) {
				val = "";
			} else if ( typeof val === "number" ) {
				val += "";
			} else if ( jQuery.isArray( val ) ) {
				val = jQuery.map( val, function( value ) {
					return value == null ? "" : value + "";
				});
			}

			hooks = jQuery.valHooks[ this.type ] || jQuery.valHooks[ this.nodeName.toLowerCase() ];

			// If set returns undefined, fall back to normal setting
			if ( !hooks || !("set" in hooks) || hooks.set( this, val, "value" ) === undefined ) {
				this.value = val;
			}
		});
	}
});

jQuery.extend({
	valHooks: {
		option: {
			get: function( elem ) {
				var val = jQuery.find.attr( elem, "value" );
				return val != null ?
					val :
					// Support: IE10-11+
					// option.text throws exceptions (#14686, #14858)
					jQuery.trim( jQuery.text( elem ) );
			}
		},
		select: {
			get: function( elem ) {
				var value, option,
					options = elem.options,
					index = elem.selectedIndex,
					one = elem.type === "select-one" || index < 0,
					values = one ? null : [],
					max = one ? index + 1 : options.length,
					i = index < 0 ?
						max :
						one ? index : 0;

				// Loop through all the selected options
				for ( ; i < max; i++ ) {
					option = options[ i ];

					// oldIE doesn't update selected after form reset (#2551)
					if ( ( option.selected || i === index ) &&
							// Don't return options that are disabled or in a disabled optgroup
							( support.optDisabled ? !option.disabled : option.getAttribute("disabled") === null ) &&
							( !option.parentNode.disabled || !jQuery.nodeName( option.parentNode, "optgroup" ) ) ) {

						// Get the specific value for the option
						value = jQuery( option ).val();

						// We don't need an array for one selects
						if ( one ) {
							return value;
						}

						// Multi-Selects return an array
						values.push( value );
					}
				}

				return values;
			},

			set: function( elem, value ) {
				var optionSet, option,
					options = elem.options,
					values = jQuery.makeArray( value ),
					i = options.length;

				while ( i-- ) {
					option = options[ i ];

					if ( jQuery.inArray( jQuery.valHooks.option.get( option ), values ) >= 0 ) {

						// Support: IE6
						// When new option element is added to select box we need to
						// force reflow of newly added node in order to workaround delay
						// of initialization properties
						try {
							option.selected = optionSet = true;

						} catch ( _ ) {

							// Will be executed only in IE6
							option.scrollHeight;
						}

					} else {
						option.selected = false;
					}
				}

				// Force browsers to behave consistently when non-matching value is set
				if ( !optionSet ) {
					elem.selectedIndex = -1;
				}

				return options;
			}
		}
	}
});

// Radios and checkboxes getter/setter
jQuery.each([ "radio", "checkbox" ], function() {
	jQuery.valHooks[ this ] = {
		set: function( elem, value ) {
			if ( jQuery.isArray( value ) ) {
				return ( elem.checked = jQuery.inArray( jQuery(elem).val(), value ) >= 0 );
			}
		}
	};
	if ( !support.checkOn ) {
		jQuery.valHooks[ this ].get = function( elem ) {
			// Support: Webkit
			// "" is returned instead of "on" if a value isn't specified
			return elem.getAttribute("value") === null ? "on" : elem.value;
		};
	}
});




var nodeHook, boolHook,
	attrHandle = jQuery.expr.attrHandle,
	ruseDefault = /^(?:checked|selected)$/i,
	getSetAttribute = support.getSetAttribute,
	getSetInput = support.input;

jQuery.fn.extend({
	attr: function( name, value ) {
		return access( this, jQuery.attr, name, value, arguments.length > 1 );
	},

	removeAttr: function( name ) {
		return this.each(function() {
			jQuery.removeAttr( this, name );
		});
	}
});

jQuery.extend({
	attr: function( elem, name, value ) {
		var hooks, ret,
			nType = elem.nodeType;

		// don't get/set attributes on text, comment and attribute nodes
		if ( !elem || nType === 3 || nType === 8 || nType === 2 ) {
			return;
		}

		// Fallback to prop when attributes are not supported
		if ( typeof elem.getAttribute === strundefined ) {
			return jQuery.prop( elem, name, value );
		}

		// All attributes are lowercase
		// Grab necessary hook if one is defined
		if ( nType !== 1 || !jQuery.isXMLDoc( elem ) ) {
			name = name.toLowerCase();
			hooks = jQuery.attrHooks[ name ] ||
				( jQuery.expr.match.bool.test( name ) ? boolHook : nodeHook );
		}

		if ( value !== undefined ) {

			if ( value === null ) {
				jQuery.removeAttr( elem, name );

			} else if ( hooks && "set" in hooks && (ret = hooks.set( elem, value, name )) !== undefined ) {
				return ret;

			} else {
				elem.setAttribute( name, value + "" );
				return value;
			}

		} else if ( hooks && "get" in hooks && (ret = hooks.get( elem, name )) !== null ) {
			return ret;

		} else {
			ret = jQuery.find.attr( elem, name );

			// Non-existent attributes return null, we normalize to undefined
			return ret == null ?
				undefined :
				ret;
		}
	},

	removeAttr: function( elem, value ) {
		var name, propName,
			i = 0,
			attrNames = value && value.match( rnotwhite );

		if ( attrNames && elem.nodeType === 1 ) {
			while ( (name = attrNames[i++]) ) {
				propName = jQuery.propFix[ name ] || name;

				// Boolean attributes get special treatment (#10870)
				if ( jQuery.expr.match.bool.test( name ) ) {
					// Set corresponding property to false
					if ( getSetInput && getSetAttribute || !ruseDefault.test( name ) ) {
						elem[ propName ] = false;
					// Support: IE<9
					// Also clear defaultChecked/defaultSelected (if appropriate)
					} else {
						elem[ jQuery.camelCase( "default-" + name ) ] =
							elem[ propName ] = false;
					}

				// See #9699 for explanation of this approach (setting first, then removal)
				} else {
					jQuery.attr( elem, name, "" );
				}

				elem.removeAttribute( getSetAttribute ? name : propName );
			}
		}
	},

	attrHooks: {
		type: {
			set: function( elem, value ) {
				if ( !support.radioValue && value === "radio" && jQuery.nodeName(elem, "input") ) {
					// Setting the type on a radio button after the value resets the value in IE6-9
					// Reset value to default in case type is set after value during creation
					var val = elem.value;
					elem.setAttribute( "type", value );
					if ( val ) {
						elem.value = val;
					}
					return value;
				}
			}
		}
	}
});

// Hook for boolean attributes
boolHook = {
	set: function( elem, value, name ) {
		if ( value === false ) {
			// Remove boolean attributes when set to false
			jQuery.removeAttr( elem, name );
		} else if ( getSetInput && getSetAttribute || !ruseDefault.test( name ) ) {
			// IE<8 needs the *property* name
			elem.setAttribute( !getSetAttribute && jQuery.propFix[ name ] || name, name );

		// Use defaultChecked and defaultSelected for oldIE
		} else {
			elem[ jQuery.camelCase( "default-" + name ) ] = elem[ name ] = true;
		}

		return name;
	}
};

// Retrieve booleans specially
jQuery.each( jQuery.expr.match.bool.source.match( /\w+/g ), function( i, name ) {

	var getter = attrHandle[ name ] || jQuery.find.attr;

	attrHandle[ name ] = getSetInput && getSetAttribute || !ruseDefault.test( name ) ?
		function( elem, name, isXML ) {
			var ret, handle;
			if ( !isXML ) {
				// Avoid an infinite loop by temporarily removing this function from the getter
				handle = attrHandle[ name ];
				attrHandle[ name ] = ret;
				ret = getter( elem, name, isXML ) != null ?
					name.toLowerCase() :
					null;
				attrHandle[ name ] = handle;
			}
			return ret;
		} :
		function( elem, name, isXML ) {
			if ( !isXML ) {
				return elem[ jQuery.camelCase( "default-" + name ) ] ?
					name.toLowerCase() :
					null;
			}
		};
});

// fix oldIE attroperties
if ( !getSetInput || !getSetAttribute ) {
	jQuery.attrHooks.value = {
		set: function( elem, value, name ) {
			if ( jQuery.nodeName( elem, "input" ) ) {
				// Does not return so that setAttribute is also used
				elem.defaultValue = value;
			} else {
				// Use nodeHook if defined (#1954); otherwise setAttribute is fine
				return nodeHook && nodeHook.set( elem, value, name );
			}
		}
	};
}

// IE6/7 do not support getting/setting some attributes with get/setAttribute
if ( !getSetAttribute ) {

	// Use this for any attribute in IE6/7
	// This fixes almost every IE6/7 issue
	nodeHook = {
		set: function( elem, value, name ) {
			// Set the existing or create a new attribute node
			var ret = elem.getAttributeNode( name );
			if ( !ret ) {
				elem.setAttributeNode(
					(ret = elem.ownerDocument.createAttribute( name ))
				);
			}

			ret.value = value += "";

			// Break association with cloned elements by also using setAttribute (#9646)
			if ( name === "value" || value === elem.getAttribute( name ) ) {
				return value;
			}
		}
	};

	// Some attributes are constructed with empty-string values when not defined
	attrHandle.id = attrHandle.name = attrHandle.coords =
		function( elem, name, isXML ) {
			var ret;
			if ( !isXML ) {
				return (ret = elem.getAttributeNode( name )) && ret.value !== "" ?
					ret.value :
					null;
			}
		};

	// Fixing value retrieval on a button requires this module
	jQuery.valHooks.button = {
		get: function( elem, name ) {
			var ret = elem.getAttributeNode( name );
			if ( ret && ret.specified ) {
				return ret.value;
			}
		},
		set: nodeHook.set
	};

	// Set contenteditable to false on removals(#10429)
	// Setting to empty string throws an error as an invalid value
	jQuery.attrHooks.contenteditable = {
		set: function( elem, value, name ) {
			nodeHook.set( elem, value === "" ? false : value, name );
		}
	};

	// Set width and height to auto instead of 0 on empty string( Bug #8150 )
	// This is for removals
	jQuery.each([ "width", "height" ], function( i, name ) {
		jQuery.attrHooks[ name ] = {
			set: function( elem, value ) {
				if ( value === "" ) {
					elem.setAttribute( name, "auto" );
					return value;
				}
			}
		};
	});
}

if ( !support.style ) {
	jQuery.attrHooks.style = {
		get: function( elem ) {
			// Return undefined in the case of empty string
			// Note: IE uppercases css property names, but if we were to .toLowerCase()
			// .cssText, that would destroy case senstitivity in URL's, like in "background"
			return elem.style.cssText || undefined;
		},
		set: function( elem, value ) {
			return ( elem.style.cssText = value + "" );
		}
	};
}




var rfocusable = /^(?:input|select|textarea|button|object)$/i,
	rclickable = /^(?:a|area)$/i;

jQuery.fn.extend({
	prop: function( name, value ) {
		return access( this, jQuery.prop, name, value, arguments.length > 1 );
	},

	removeProp: function( name ) {
		name = jQuery.propFix[ name ] || name;
		return this.each(function() {
			// try/catch handles cases where IE balks (such as removing a property on window)
			try {
				this[ name ] = undefined;
				delete this[ name ];
			} catch( e ) {}
		});
	}
});

jQuery.extend({
	propFix: {
		"for": "htmlFor",
		"class": "className"
	},

	prop: function( elem, name, value ) {
		var ret, hooks, notxml,
			nType = elem.nodeType;

		// don't get/set properties on text, comment and attribute nodes
		if ( !elem || nType === 3 || nType === 8 || nType === 2 ) {
			return;
		}

		notxml = nType !== 1 || !jQuery.isXMLDoc( elem );

		if ( notxml ) {
			// Fix name and attach hooks
			name = jQuery.propFix[ name ] || name;
			hooks = jQuery.propHooks[ name ];
		}

		if ( value !== undefined ) {
			return hooks && "set" in hooks && (ret = hooks.set( elem, value, name )) !== undefined ?
				ret :
				( elem[ name ] = value );

		} else {
			return hooks && "get" in hooks && (ret = hooks.get( elem, name )) !== null ?
				ret :
				elem[ name ];
		}
	},

	propHooks: {
		tabIndex: {
			get: function( elem ) {
				// elem.tabIndex doesn't always return the correct value when it hasn't been explicitly set
				// http://fluidproject.org/blog/2008/01/09/getting-setting-and-removing-tabindex-values-with-javascript/
				// Use proper attribute retrieval(#12072)
				var tabindex = jQuery.find.attr( elem, "tabindex" );

				return tabindex ?
					parseInt( tabindex, 10 ) :
					rfocusable.test( elem.nodeName ) || rclickable.test( elem.nodeName ) && elem.href ?
						0 :
						-1;
			}
		}
	}
});

// Some attributes require a special call on IE
// http://msdn.microsoft.com/en-us/library/ms536429%28VS.85%29.aspx
if ( !support.hrefNormalized ) {
	// href/src property should get the full normalized URL (#10299/#12915)
	jQuery.each([ "href", "src" ], function( i, name ) {
		jQuery.propHooks[ name ] = {
			get: function( elem ) {
				return elem.getAttribute( name, 4 );
			}
		};
	});
}

// Support: Safari, IE9+
// mis-reports the default selected property of an option
// Accessing the parent's selectedIndex property fixes it
if ( !support.optSelected ) {
	jQuery.propHooks.selected = {
		get: function( elem ) {
			var parent = elem.parentNode;

			if ( parent ) {
				parent.selectedIndex;

				// Make sure that it also works with optgroups, see #5701
				if ( parent.parentNode ) {
					parent.parentNode.selectedIndex;
				}
			}
			return null;
		}
	};
}

jQuery.each([
	"tabIndex",
	"readOnly",
	"maxLength",
	"cellSpacing",
	"cellPadding",
	"rowSpan",
	"colSpan",
	"useMap",
	"frameBorder",
	"contentEditable"
], function() {
	jQuery.propFix[ this.toLowerCase() ] = this;
});

// IE6/7 call enctype encoding
if ( !support.enctype ) {
	jQuery.propFix.enctype = "encoding";
}




var rclass = /[\t\r\n\f]/g;

jQuery.fn.extend({
	addClass: function( value ) {
		var classes, elem, cur, clazz, j, finalValue,
			i = 0,
			len = this.length,
			proceed = typeof value === "string" && value;

		if ( jQuery.isFunction( value ) ) {
			return this.each(function( j ) {
				jQuery( this ).addClass( value.call( this, j, this.className ) );
			});
		}

		if ( proceed ) {
			// The disjunction here is for better compressibility (see removeClass)
			classes = ( value || "" ).match( rnotwhite ) || [];

			for ( ; i < len; i++ ) {
				elem = this[ i ];
				cur = elem.nodeType === 1 && ( elem.className ?
					( " " + elem.className + " " ).replace( rclass, " " ) :
					" "
				);

				if ( cur ) {
					j = 0;
					while ( (clazz = classes[j++]) ) {
						if ( cur.indexOf( " " + clazz + " " ) < 0 ) {
							cur += clazz + " ";
						}
					}

					// only assign if different to avoid unneeded rendering.
					finalValue = jQuery.trim( cur );
					if ( elem.className !== finalValue ) {
						elem.className = finalValue;
					}
				}
			}
		}

		return this;
	},

	removeClass: function( value ) {
		var classes, elem, cur, clazz, j, finalValue,
			i = 0,
			len = this.length,
			proceed = arguments.length === 0 || typeof value === "string" && value;

		if ( jQuery.isFunction( value ) ) {
			return this.each(function( j ) {
				jQuery( this ).removeClass( value.call( this, j, this.className ) );
			});
		}
		if ( proceed ) {
			classes = ( value || "" ).match( rnotwhite ) || [];

			for ( ; i < len; i++ ) {
				elem = this[ i ];
				// This expression is here for better compressibility (see addClass)
				cur = elem.nodeType === 1 && ( elem.className ?
					( " " + elem.className + " " ).replace( rclass, " " ) :
					""
				);

				if ( cur ) {
					j = 0;
					while ( (clazz = classes[j++]) ) {
						// Remove *all* instances
						while ( cur.indexOf( " " + clazz + " " ) >= 0 ) {
							cur = cur.replace( " " + clazz + " ", " " );
						}
					}

					// only assign if different to avoid unneeded rendering.
					finalValue = value ? jQuery.trim( cur ) : "";
					if ( elem.className !== finalValue ) {
						elem.className = finalValue;
					}
				}
			}
		}

		return this;
	},

	toggleClass: function( value, stateVal ) {
		var type = typeof value;

		if ( typeof stateVal === "boolean" && type === "string" ) {
			return stateVal ? this.addClass( value ) : this.removeClass( value );
		}

		if ( jQuery.isFunction( value ) ) {
			return this.each(function( i ) {
				jQuery( this ).toggleClass( value.call(this, i, this.className, stateVal), stateVal );
			});
		}

		return this.each(function() {
			if ( type === "string" ) {
				// toggle individual class names
				var className,
					i = 0,
					self = jQuery( this ),
					classNames = value.match( rnotwhite ) || [];

				while ( (className = classNames[ i++ ]) ) {
					// check each className given, space separated list
					if ( self.hasClass( className ) ) {
						self.removeClass( className );
					} else {
						self.addClass( className );
					}
				}

			// Toggle whole class name
			} else if ( type === strundefined || type === "boolean" ) {
				if ( this.className ) {
					// store className if set
					jQuery._data( this, "__className__", this.className );
				}

				// If the element has a class name or if we're passed "false",
				// then remove the whole classname (if there was one, the above saved it).
				// Otherwise bring back whatever was previously saved (if anything),
				// falling back to the empty string if nothing was stored.
				this.className = this.className || value === false ? "" : jQuery._data( this, "__className__" ) || "";
			}
		});
	},

	hasClass: function( selector ) {
		var className = " " + selector + " ",
			i = 0,
			l = this.length;
		for ( ; i < l; i++ ) {
			if ( this[i].nodeType === 1 && (" " + this[i].className + " ").replace(rclass, " ").indexOf( className ) >= 0 ) {
				return true;
			}
		}

		return false;
	}
});




// Return jQuery for attributes-only inclusion


jQuery.each( ("blur focus focusin focusout load resize scroll unload click dblclick " +
	"mousedown mouseup mousemove mouseover mouseout mouseenter mouseleave " +
	"change select submit keydown keypress keyup error contextmenu").split(" "), function( i, name ) {

	// Handle event binding
	jQuery.fn[ name ] = function( data, fn ) {
		return arguments.length > 0 ?
			this.on( name, null, data, fn ) :
			this.trigger( name );
	};
});

jQuery.fn.extend({
	hover: function( fnOver, fnOut ) {
		return this.mouseenter( fnOver ).mouseleave( fnOut || fnOver );
	},

	bind: function( types, data, fn ) {
		return this.on( types, null, data, fn );
	},
	unbind: function( types, fn ) {
		return this.off( types, null, fn );
	},

	delegate: function( selector, types, data, fn ) {
		return this.on( types, selector, data, fn );
	},
	undelegate: function( selector, types, fn ) {
		// ( namespace ) or ( selector, types [, fn] )
		return arguments.length === 1 ? this.off( selector, "**" ) : this.off( types, selector || "**", fn );
	}
});


var nonce = jQuery.now();

var rquery = (/\?/);



var rvalidtokens = /(,)|(\[|{)|(}|])|"(?:[^"\\\r\n]|\\["\\\/bfnrt]|\\u[\da-fA-F]{4})*"\s*:?|true|false|null|-?(?!0\d)\d+(?:\.\d+|)(?:[eE][+-]?\d+|)/g;

jQuery.parseJSON = function( data ) {
	// Attempt to parse using the native JSON parser first
	if ( window.JSON && window.JSON.parse ) {
		// Support: Android 2.3
		// Workaround failure to string-cast null input
		return window.JSON.parse( data + "" );
	}

	var requireNonComma,
		depth = null,
		str = jQuery.trim( data + "" );

	// Guard against invalid (and possibly dangerous) input by ensuring that nothing remains
	// after removing valid tokens
	return str && !jQuery.trim( str.replace( rvalidtokens, function( token, comma, open, close ) {

		// Force termination if we see a misplaced comma
		if ( requireNonComma && comma ) {
			depth = 0;
		}

		// Perform no more replacements after returning to outermost depth
		if ( depth === 0 ) {
			return token;
		}

		// Commas must not follow "[", "{", or ","
		requireNonComma = open || comma;

		// Determine new depth
		// array/object open ("[" or "{"): depth += true - false (increment)
		// array/object close ("]" or "}"): depth += false - true (decrement)
		// other cases ("," or primitive): depth += true - true (numeric cast)
		depth += !close - !open;

		// Remove this token
		return "";
	}) ) ?
		( Function( "return " + str ) )() :
		jQuery.error( "Invalid JSON: " + data );
};


// Cross-browser xml parsing
jQuery.parseXML = function( data ) {
	var xml, tmp;
	if ( !data || typeof data !== "string" ) {
		return null;
	}
	try {
		if ( window.DOMParser ) { // Standard
			tmp = new DOMParser();
			xml = tmp.parseFromString( data, "text/xml" );
		} else { // IE
			xml = new ActiveXObject( "Microsoft.XMLDOM" );
			xml.async = "false";
			xml.loadXML( data );
		}
	} catch( e ) {
		xml = undefined;
	}
	if ( !xml || !xml.documentElement || xml.getElementsByTagName( "parsererror" ).length ) {
		jQuery.error( "Invalid XML: " + data );
	}
	return xml;
};


var
	// Document location
	ajaxLocParts,
	ajaxLocation,

	rhash = /#.*$/,
	rts = /([?&])_=[^&]*/,
	rheaders = /^(.*?):[ \t]*([^\r\n]*)\r?$/mg, // IE leaves an \r character at EOL
	// #7653, #8125, #8152: local protocol detection
	rlocalProtocol = /^(?:about|app|app-storage|.+-extension|file|res|widget):$/,
	rnoContent = /^(?:GET|HEAD)$/,
	rprotocol = /^\/\//,
	rurl = /^([\w.+-]+:)(?:\/\/(?:[^\/?#]*@|)([^\/?#:]*)(?::(\d+)|)|)/,

	/* Prefilters
	 * 1) They are useful to introduce custom dataTypes (see ajax/jsonp.js for an example)
	 * 2) These are called:
	 *    - BEFORE asking for a transport
	 *    - AFTER param serialization (s.data is a string if s.processData is true)
	 * 3) key is the dataType
	 * 4) the catchall symbol "*" can be used
	 * 5) execution will start with transport dataType and THEN continue down to "*" if needed
	 */
	prefilters = {},

	/* Transports bindings
	 * 1) key is the dataType
	 * 2) the catchall symbol "*" can be used
	 * 3) selection will start with transport dataType and THEN go to "*" if needed
	 */
	transports = {},

	// Avoid comment-prolog char sequence (#10098); must appease lint and evade compression
	allTypes = "*/".concat("*");

// #8138, IE may throw an exception when accessing
// a field from window.location if document.domain has been set
try {
	ajaxLocation = location.href;
} catch( e ) {
	// Use the href attribute of an A element
	// since IE will modify it given document.location
	ajaxLocation = document.createElement( "a" );
	ajaxLocation.href = "";
	ajaxLocation = ajaxLocation.href;
}

// Segment location into parts
ajaxLocParts = rurl.exec( ajaxLocation.toLowerCase() ) || [];

// Base "constructor" for jQuery.ajaxPrefilter and jQuery.ajaxTransport
function addToPrefiltersOrTransports( structure ) {

	// dataTypeExpression is optional and defaults to "*"
	return function( dataTypeExpression, func ) {

		if ( typeof dataTypeExpression !== "string" ) {
			func = dataTypeExpression;
			dataTypeExpression = "*";
		}

		var dataType,
			i = 0,
			dataTypes = dataTypeExpression.toLowerCase().match( rnotwhite ) || [];

		if ( jQuery.isFunction( func ) ) {
			// For each dataType in the dataTypeExpression
			while ( (dataType = dataTypes[i++]) ) {
				// Prepend if requested
				if ( dataType.charAt( 0 ) === "+" ) {
					dataType = dataType.slice( 1 ) || "*";
					(structure[ dataType ] = structure[ dataType ] || []).unshift( func );

				// Otherwise append
				} else {
					(structure[ dataType ] = structure[ dataType ] || []).push( func );
				}
			}
		}
	};
}

// Base inspection function for prefilters and transports
function inspectPrefiltersOrTransports( structure, options, originalOptions, jqXHR ) {

	var inspected = {},
		seekingTransport = ( structure === transports );

	function inspect( dataType ) {
		var selected;
		inspected[ dataType ] = true;
		jQuery.each( structure[ dataType ] || [], function( _, prefilterOrFactory ) {
			var dataTypeOrTransport = prefilterOrFactory( options, originalOptions, jqXHR );
			if ( typeof dataTypeOrTransport === "string" && !seekingTransport && !inspected[ dataTypeOrTransport ] ) {
				options.dataTypes.unshift( dataTypeOrTransport );
				inspect( dataTypeOrTransport );
				return false;
			} else if ( seekingTransport ) {
				return !( selected = dataTypeOrTransport );
			}
		});
		return selected;
	}

	return inspect( options.dataTypes[ 0 ] ) || !inspected[ "*" ] && inspect( "*" );
}

// A special extend for ajax options
// that takes "flat" options (not to be deep extended)
// Fixes #9887
function ajaxExtend( target, src ) {
	var deep, key,
		flatOptions = jQuery.ajaxSettings.flatOptions || {};

	for ( key in src ) {
		if ( src[ key ] !== undefined ) {
			( flatOptions[ key ] ? target : ( deep || (deep = {}) ) )[ key ] = src[ key ];
		}
	}
	if ( deep ) {
		jQuery.extend( true, target, deep );
	}

	return target;
}

/* Handles responses to an ajax request:
 * - finds the right dataType (mediates between content-type and expected dataType)
 * - returns the corresponding response
 */
function ajaxHandleResponses( s, jqXHR, responses ) {
	var firstDataType, ct, finalDataType, type,
		contents = s.contents,
		dataTypes = s.dataTypes;

	// Remove auto dataType and get content-type in the process
	while ( dataTypes[ 0 ] === "*" ) {
		dataTypes.shift();
		if ( ct === undefined ) {
			ct = s.mimeType || jqXHR.getResponseHeader("Content-Type");
		}
	}

	// Check if we're dealing with a known content-type
	if ( ct ) {
		for ( type in contents ) {
			if ( contents[ type ] && contents[ type ].test( ct ) ) {
				dataTypes.unshift( type );
				break;
			}
		}
	}

	// Check to see if we have a response for the expected dataType
	if ( dataTypes[ 0 ] in responses ) {
		finalDataType = dataTypes[ 0 ];
	} else {
		// Try convertible dataTypes
		for ( type in responses ) {
			if ( !dataTypes[ 0 ] || s.converters[ type + " " + dataTypes[0] ] ) {
				finalDataType = type;
				break;
			}
			if ( !firstDataType ) {
				firstDataType = type;
			}
		}
		// Or just use first one
		finalDataType = finalDataType || firstDataType;
	}

	// If we found a dataType
	// We add the dataType to the list if needed
	// and return the corresponding response
	if ( finalDataType ) {
		if ( finalDataType !== dataTypes[ 0 ] ) {
			dataTypes.unshift( finalDataType );
		}
		return responses[ finalDataType ];
	}
}

/* Chain conversions given the request and the original response
 * Also sets the responseXXX fields on the jqXHR instance
 */
function ajaxConvert( s, response, jqXHR, isSuccess ) {
	var conv2, current, conv, tmp, prev,
		converters = {},
		// Work with a copy of dataTypes in case we need to modify it for conversion
		dataTypes = s.dataTypes.slice();

	// Create converters map with lowercased keys
	if ( dataTypes[ 1 ] ) {
		for ( conv in s.converters ) {
			converters[ conv.toLowerCase() ] = s.converters[ conv ];
		}
	}

	current = dataTypes.shift();

	// Convert to each sequential dataType
	while ( current ) {

		if ( s.responseFields[ current ] ) {
			jqXHR[ s.responseFields[ current ] ] = response;
		}

		// Apply the dataFilter if provided
		if ( !prev && isSuccess && s.dataFilter ) {
			response = s.dataFilter( response, s.dataType );
		}

		prev = current;
		current = dataTypes.shift();

		if ( current ) {

			// There's only work to do if current dataType is non-auto
			if ( current === "*" ) {

				current = prev;

			// Convert response if prev dataType is non-auto and differs from current
			} else if ( prev !== "*" && prev !== current ) {

				// Seek a direct converter
				conv = converters[ prev + " " + current ] || converters[ "* " + current ];

				// If none found, seek a pair
				if ( !conv ) {
					for ( conv2 in converters ) {

						// If conv2 outputs current
						tmp = conv2.split( " " );
						if ( tmp[ 1 ] === current ) {

							// If prev can be converted to accepted input
							conv = converters[ prev + " " + tmp[ 0 ] ] ||
								converters[ "* " + tmp[ 0 ] ];
							if ( conv ) {
								// Condense equivalence converters
								if ( conv === true ) {
									conv = converters[ conv2 ];

								// Otherwise, insert the intermediate dataType
								} else if ( converters[ conv2 ] !== true ) {
									current = tmp[ 0 ];
									dataTypes.unshift( tmp[ 1 ] );
								}
								break;
							}
						}
					}
				}

				// Apply converter (if not an equivalence)
				if ( conv !== true ) {

					// Unless errors are allowed to bubble, catch and return them
					if ( conv && s[ "throws" ] ) {
						response = conv( response );
					} else {
						try {
							response = conv( response );
						} catch ( e ) {
							return { state: "parsererror", error: conv ? e : "No conversion from " + prev + " to " + current };
						}
					}
				}
			}
		}
	}

	return { state: "success", data: response };
}

jQuery.extend({

	// Counter for holding the number of active queries
	active: 0,

	// Last-Modified header cache for next request
	lastModified: {},
	etag: {},

	ajaxSettings: {
		url: ajaxLocation,
		type: "GET",
		isLocal: rlocalProtocol.test( ajaxLocParts[ 1 ] ),
		global: true,
		processData: true,
		async: true,
		contentType: "application/x-www-form-urlencoded; charset=UTF-8",
		/*
		timeout: 0,
		data: null,
		dataType: null,
		username: null,
		password: null,
		cache: null,
		throws: false,
		traditional: false,
		headers: {},
		*/

		accepts: {
			"*": allTypes,
			text: "text/plain",
			html: "text/html",
			xml: "application/xml, text/xml",
			json: "application/json, text/javascript"
		},

		contents: {
			xml: /xml/,
			html: /html/,
			json: /json/
		},

		responseFields: {
			xml: "responseXML",
			text: "responseText",
			json: "responseJSON"
		},

		// Data converters
		// Keys separate source (or catchall "*") and destination types with a single space
		converters: {

			// Convert anything to text
			"* text": String,

			// Text to html (true = no transformation)
			"text html": true,

			// Evaluate text as a json expression
			"text json": jQuery.parseJSON,

			// Parse text as xml
			"text xml": jQuery.parseXML
		},

		// For options that shouldn't be deep extended:
		// you can add your own custom options here if
		// and when you create one that shouldn't be
		// deep extended (see ajaxExtend)
		flatOptions: {
			url: true,
			context: true
		}
	},

	// Creates a full fledged settings object into target
	// with both ajaxSettings and settings fields.
	// If target is omitted, writes into ajaxSettings.
	ajaxSetup: function( target, settings ) {
		return settings ?

			// Building a settings object
			ajaxExtend( ajaxExtend( target, jQuery.ajaxSettings ), settings ) :

			// Extending ajaxSettings
			ajaxExtend( jQuery.ajaxSettings, target );
	},

	ajaxPrefilter: addToPrefiltersOrTransports( prefilters ),
	ajaxTransport: addToPrefiltersOrTransports( transports ),

	// Main method
	ajax: function( url, options ) {

		// If url is an object, simulate pre-1.5 signature
		if ( typeof url === "object" ) {
			options = url;
			url = undefined;
		}

		// Force options to be an object
		options = options || {};

		var // Cross-domain detection vars
			parts,
			// Loop variable
			i,
			// URL without anti-cache param
			cacheURL,
			// Response headers as string
			responseHeadersString,
			// timeout handle
			timeoutTimer,

			// To know if global events are to be dispatched
			fireGlobals,

			transport,
			// Response headers
			responseHeaders,
			// Create the final options object
			s = jQuery.ajaxSetup( {}, options ),
			// Callbacks context
			callbackContext = s.context || s,
			// Context for global events is callbackContext if it is a DOM node or jQuery collection
			globalEventContext = s.context && ( callbackContext.nodeType || callbackContext.jquery ) ?
				jQuery( callbackContext ) :
				jQuery.event,
			// Deferreds
			deferred = jQuery.Deferred(),
			completeDeferred = jQuery.Callbacks("once memory"),
			// Status-dependent callbacks
			statusCode = s.statusCode || {},
			// Headers (they are sent all at once)
			requestHeaders = {},
			requestHeadersNames = {},
			// The jqXHR state
			state = 0,
			// Default abort message
			strAbort = "canceled",
			// Fake xhr
			jqXHR = {
				readyState: 0,

				// Builds headers hashtable if needed
				getResponseHeader: function( key ) {
					var match;
					if ( state === 2 ) {
						if ( !responseHeaders ) {
							responseHeaders = {};
							while ( (match = rheaders.exec( responseHeadersString )) ) {
								responseHeaders[ match[1].toLowerCase() ] = match[ 2 ];
							}
						}
						match = responseHeaders[ key.toLowerCase() ];
					}
					return match == null ? null : match;
				},

				// Raw string
				getAllResponseHeaders: function() {
					return state === 2 ? responseHeadersString : null;
				},

				// Caches the header
				setRequestHeader: function( name, value ) {
					var lname = name.toLowerCase();
					if ( !state ) {
						name = requestHeadersNames[ lname ] = requestHeadersNames[ lname ] || name;
						requestHeaders[ name ] = value;
					}
					return this;
				},

				// Overrides response content-type header
				overrideMimeType: function( type ) {
					if ( !state ) {
						s.mimeType = type;
					}
					return this;
				},

				// Status-dependent callbacks
				statusCode: function( map ) {
					var code;
					if ( map ) {
						if ( state < 2 ) {
							for ( code in map ) {
								// Lazy-add the new callback in a way that preserves old ones
								statusCode[ code ] = [ statusCode[ code ], map[ code ] ];
							}
						} else {
							// Execute the appropriate callbacks
							jqXHR.always( map[ jqXHR.status ] );
						}
					}
					return this;
				},

				// Cancel the request
				abort: function( statusText ) {
					var finalText = statusText || strAbort;
					if ( transport ) {
						transport.abort( finalText );
					}
					done( 0, finalText );
					return this;
				}
			};

		// Attach deferreds
		deferred.promise( jqXHR ).complete = completeDeferred.add;
		jqXHR.success = jqXHR.done;
		jqXHR.error = jqXHR.fail;

		// Remove hash character (#7531: and string promotion)
		// Add protocol if not provided (#5866: IE7 issue with protocol-less urls)
		// Handle falsy url in the settings object (#10093: consistency with old signature)
		// We also use the url parameter if available
		s.url = ( ( url || s.url || ajaxLocation ) + "" ).replace( rhash, "" ).replace( rprotocol, ajaxLocParts[ 1 ] + "//" );

		// Alias method option to type as per ticket #12004
		s.type = options.method || options.type || s.method || s.type;

		// Extract dataTypes list
		s.dataTypes = jQuery.trim( s.dataType || "*" ).toLowerCase().match( rnotwhite ) || [ "" ];

		// A cross-domain request is in order when we have a protocol:host:port mismatch
		if ( s.crossDomain == null ) {
			parts = rurl.exec( s.url.toLowerCase() );
			s.crossDomain = !!( parts &&
				( parts[ 1 ] !== ajaxLocParts[ 1 ] || parts[ 2 ] !== ajaxLocParts[ 2 ] ||
					( parts[ 3 ] || ( parts[ 1 ] === "http:" ? "80" : "443" ) ) !==
						( ajaxLocParts[ 3 ] || ( ajaxLocParts[ 1 ] === "http:" ? "80" : "443" ) ) )
			);
		}

		// Convert data if not already a string
		if ( s.data && s.processData && typeof s.data !== "string" ) {
			s.data = jQuery.param( s.data, s.traditional );
		}

		// Apply prefilters
		inspectPrefiltersOrTransports( prefilters, s, options, jqXHR );

		// If request was aborted inside a prefilter, stop there
		if ( state === 2 ) {
			return jqXHR;
		}

		// We can fire global events as of now if asked to
		// Don't fire events if jQuery.event is undefined in an AMD-usage scenario (#15118)
		fireGlobals = jQuery.event && s.global;

		// Watch for a new set of requests
		if ( fireGlobals && jQuery.active++ === 0 ) {
			jQuery.event.trigger("ajaxStart");
		}

		// Uppercase the type
		s.type = s.type.toUpperCase();

		// Determine if request has content
		s.hasContent = !rnoContent.test( s.type );

		// Save the URL in case we're toying with the If-Modified-Since
		// and/or If-None-Match header later on
		cacheURL = s.url;

		// More options handling for requests with no content
		if ( !s.hasContent ) {

			// If data is available, append data to url
			if ( s.data ) {
				cacheURL = ( s.url += ( rquery.test( cacheURL ) ? "&" : "?" ) + s.data );
				// #9682: remove data so that it's not used in an eventual retry
				delete s.data;
			}

			// Add anti-cache in url if needed
			if ( s.cache === false ) {
				s.url = rts.test( cacheURL ) ?

					// If there is already a '_' parameter, set its value
					cacheURL.replace( rts, "$1_=" + nonce++ ) :

					// Otherwise add one to the end
					cacheURL + ( rquery.test( cacheURL ) ? "&" : "?" ) + "_=" + nonce++;
			}
		}

		// Set the If-Modified-Since and/or If-None-Match header, if in ifModified mode.
		if ( s.ifModified ) {
			if ( jQuery.lastModified[ cacheURL ] ) {
				jqXHR.setRequestHeader( "If-Modified-Since", jQuery.lastModified[ cacheURL ] );
			}
			if ( jQuery.etag[ cacheURL ] ) {
				jqXHR.setRequestHeader( "If-None-Match", jQuery.etag[ cacheURL ] );
			}
		}

		// Set the correct header, if data is being sent
		if ( s.data && s.hasContent && s.contentType !== false || options.contentType ) {
			jqXHR.setRequestHeader( "Content-Type", s.contentType );
		}

		// Set the Accepts header for the server, depending on the dataType
		jqXHR.setRequestHeader(
			"Accept",
			s.dataTypes[ 0 ] && s.accepts[ s.dataTypes[0] ] ?
				s.accepts[ s.dataTypes[0] ] + ( s.dataTypes[ 0 ] !== "*" ? ", " + allTypes + "; q=0.01" : "" ) :
				s.accepts[ "*" ]
		);

		// Check for headers option
		for ( i in s.headers ) {
			jqXHR.setRequestHeader( i, s.headers[ i ] );
		}

		// Allow custom headers/mimetypes and early abort
		if ( s.beforeSend && ( s.beforeSend.call( callbackContext, jqXHR, s ) === false || state === 2 ) ) {
			// Abort if not done already and return
			return jqXHR.abort();
		}

		// aborting is no longer a cancellation
		strAbort = "abort";

		// Install callbacks on deferreds
		for ( i in { success: 1, error: 1, complete: 1 } ) {
			jqXHR[ i ]( s[ i ] );
		}

		// Get transport
		transport = inspectPrefiltersOrTransports( transports, s, options, jqXHR );

		// If no transport, we auto-abort
		if ( !transport ) {
			done( -1, "No Transport" );
		} else {
			jqXHR.readyState = 1;

			// Send global event
			if ( fireGlobals ) {
				globalEventContext.trigger( "ajaxSend", [ jqXHR, s ] );
			}
			// Timeout
			if ( s.async && s.timeout > 0 ) {
				timeoutTimer = setTimeout(function() {
					jqXHR.abort("timeout");
				}, s.timeout );
			}

			try {
				state = 1;
				transport.send( requestHeaders, done );
			} catch ( e ) {
				// Propagate exception as error if not done
				if ( state < 2 ) {
					done( -1, e );
				// Simply rethrow otherwise
				} else {
					throw e;
				}
			}
		}

		// Callback for when everything is done
		function done( status, nativeStatusText, responses, headers ) {
			var isSuccess, success, error, response, modified,
				statusText = nativeStatusText;

			// Called once
			if ( state === 2 ) {
				return;
			}

			// State is "done" now
			state = 2;

			// Clear timeout if it exists
			if ( timeoutTimer ) {
				clearTimeout( timeoutTimer );
			}

			// Dereference transport for early garbage collection
			// (no matter how long the jqXHR object will be used)
			transport = undefined;

			// Cache response headers
			responseHeadersString = headers || "";

			// Set readyState
			jqXHR.readyState = status > 0 ? 4 : 0;

			// Determine if successful
			isSuccess = status >= 200 && status < 300 || status === 304;

			// Get response data
			if ( responses ) {
				response = ajaxHandleResponses( s, jqXHR, responses );
			}

			// Convert no matter what (that way responseXXX fields are always set)
			response = ajaxConvert( s, response, jqXHR, isSuccess );

			// If successful, handle type chaining
			if ( isSuccess ) {

				// Set the If-Modified-Since and/or If-None-Match header, if in ifModified mode.
				if ( s.ifModified ) {
					modified = jqXHR.getResponseHeader("Last-Modified");
					if ( modified ) {
						jQuery.lastModified[ cacheURL ] = modified;
					}
					modified = jqXHR.getResponseHeader("etag");
					if ( modified ) {
						jQuery.etag[ cacheURL ] = modified;
					}
				}

				// if no content
				if ( status === 204 || s.type === "HEAD" ) {
					statusText = "nocontent";

				// if not modified
				} else if ( status === 304 ) {
					statusText = "notmodified";

				// If we have data, let's convert it
				} else {
					statusText = response.state;
					success = response.data;
					error = response.error;
					isSuccess = !error;
				}
			} else {
				// We extract error from statusText
				// then normalize statusText and status for non-aborts
				error = statusText;
				if ( status || !statusText ) {
					statusText = "error";
					if ( status < 0 ) {
						status = 0;
					}
				}
			}

			// Set data for the fake xhr object
			jqXHR.status = status;
			jqXHR.statusText = ( nativeStatusText || statusText ) + "";

			// Success/Error
			if ( isSuccess ) {
				deferred.resolveWith( callbackContext, [ success, statusText, jqXHR ] );
			} else {
				deferred.rejectWith( callbackContext, [ jqXHR, statusText, error ] );
			}

			// Status-dependent callbacks
			jqXHR.statusCode( statusCode );
			statusCode = undefined;

			if ( fireGlobals ) {
				globalEventContext.trigger( isSuccess ? "ajaxSuccess" : "ajaxError",
					[ jqXHR, s, isSuccess ? success : error ] );
			}

			// Complete
			completeDeferred.fireWith( callbackContext, [ jqXHR, statusText ] );

			if ( fireGlobals ) {
				globalEventContext.trigger( "ajaxComplete", [ jqXHR, s ] );
				// Handle the global AJAX counter
				if ( !( --jQuery.active ) ) {
					jQuery.event.trigger("ajaxStop");
				}
			}
		}

		return jqXHR;
	},

	getJSON: function( url, data, callback ) {
		return jQuery.get( url, data, callback, "json" );
	},

	getScript: function( url, callback ) {
		return jQuery.get( url, undefined, callback, "script" );
	}
});

jQuery.each( [ "get", "post" ], function( i, method ) {
	jQuery[ method ] = function( url, data, callback, type ) {
		// shift arguments if data argument was omitted
		if ( jQuery.isFunction( data ) ) {
			type = type || callback;
			callback = data;
			data = undefined;
		}

		return jQuery.ajax({
			url: url,
			type: method,
			dataType: type,
			data: data,
			success: callback
		});
	};
});


jQuery._evalUrl = function( url ) {
	return jQuery.ajax({
		url: url,
		type: "GET",
		dataType: "script",
		async: false,
		global: false,
		"throws": true
	});
};


jQuery.fn.extend({
	wrapAll: function( html ) {
		if ( jQuery.isFunction( html ) ) {
			return this.each(function(i) {
				jQuery(this).wrapAll( html.call(this, i) );
			});
		}

		if ( this[0] ) {
			// The elements to wrap the target around
			var wrap = jQuery( html, this[0].ownerDocument ).eq(0).clone(true);

			if ( this[0].parentNode ) {
				wrap.insertBefore( this[0] );
			}

			wrap.map(function() {
				var elem = this;

				while ( elem.firstChild && elem.firstChild.nodeType === 1 ) {
					elem = elem.firstChild;
				}

				return elem;
			}).append( this );
		}

		return this;
	},

	wrapInner: function( html ) {
		if ( jQuery.isFunction( html ) ) {
			return this.each(function(i) {
				jQuery(this).wrapInner( html.call(this, i) );
			});
		}

		return this.each(function() {
			var self = jQuery( this ),
				contents = self.contents();

			if ( contents.length ) {
				contents.wrapAll( html );

			} else {
				self.append( html );
			}
		});
	},

	wrap: function( html ) {
		var isFunction = jQuery.isFunction( html );

		return this.each(function(i) {
			jQuery( this ).wrapAll( isFunction ? html.call(this, i) : html );
		});
	},

	unwrap: function() {
		return this.parent().each(function() {
			if ( !jQuery.nodeName( this, "body" ) ) {
				jQuery( this ).replaceWith( this.childNodes );
			}
		}).end();
	}
});


jQuery.expr.filters.hidden = function( elem ) {
	// Support: Opera <= 12.12
	// Opera reports offsetWidths and offsetHeights less than zero on some elements
	return elem.offsetWidth <= 0 && elem.offsetHeight <= 0 ||
		(!support.reliableHiddenOffsets() &&
			((elem.style && elem.style.display) || jQuery.css( elem, "display" )) === "none");
};

jQuery.expr.filters.visible = function( elem ) {
	return !jQuery.expr.filters.hidden( elem );
};




var r20 = /%20/g,
	rbracket = /\[\]$/,
	rCRLF = /\r?\n/g,
	rsubmitterTypes = /^(?:submit|button|image|reset|file)$/i,
	rsubmittable = /^(?:input|select|textarea|keygen)/i;

function buildParams( prefix, obj, traditional, add ) {
	var name;

	if ( jQuery.isArray( obj ) ) {
		// Serialize array item.
		jQuery.each( obj, function( i, v ) {
			if ( traditional || rbracket.test( prefix ) ) {
				// Treat each array item as a scalar.
				add( prefix, v );

			} else {
				// Item is non-scalar (array or object), encode its numeric index.
				buildParams( prefix + "[" + ( typeof v === "object" ? i : "" ) + "]", v, traditional, add );
			}
		});

	} else if ( !traditional && jQuery.type( obj ) === "object" ) {
		// Serialize object item.
		for ( name in obj ) {
			buildParams( prefix + "[" + name + "]", obj[ name ], traditional, add );
		}

	} else {
		// Serialize scalar item.
		add( prefix, obj );
	}
}

// Serialize an array of form elements or a set of
// key/values into a query string
jQuery.param = function( a, traditional ) {
	var prefix,
		s = [],
		add = function( key, value ) {
			// If value is a function, invoke it and return its value
			value = jQuery.isFunction( value ) ? value() : ( value == null ? "" : value );
			s[ s.length ] = encodeURIComponent( key ) + "=" + encodeURIComponent( value );
		};

	// Set traditional to true for jQuery <= 1.3.2 behavior.
	if ( traditional === undefined ) {
		traditional = jQuery.ajaxSettings && jQuery.ajaxSettings.traditional;
	}

	// If an array was passed in, assume that it is an array of form elements.
	if ( jQuery.isArray( a ) || ( a.jquery && !jQuery.isPlainObject( a ) ) ) {
		// Serialize the form elements
		jQuery.each( a, function() {
			add( this.name, this.value );
		});

	} else {
		// If traditional, encode the "old" way (the way 1.3.2 or older
		// did it), otherwise encode params recursively.
		for ( prefix in a ) {
			buildParams( prefix, a[ prefix ], traditional, add );
		}
	}

	// Return the resulting serialization
	return s.join( "&" ).replace( r20, "+" );
};

jQuery.fn.extend({
	serialize: function() {
		return jQuery.param( this.serializeArray() );
	},
	serializeArray: function() {
		return this.map(function() {
			// Can add propHook for "elements" to filter or add form elements
			var elements = jQuery.prop( this, "elements" );
			return elements ? jQuery.makeArray( elements ) : this;
		})
		.filter(function() {
			var type = this.type;
			// Use .is(":disabled") so that fieldset[disabled] works
			return this.name && !jQuery( this ).is( ":disabled" ) &&
				rsubmittable.test( this.nodeName ) && !rsubmitterTypes.test( type ) &&
				( this.checked || !rcheckableType.test( type ) );
		})
		.map(function( i, elem ) {
			var val = jQuery( this ).val();

			return val == null ?
				null :
				jQuery.isArray( val ) ?
					jQuery.map( val, function( val ) {
						return { name: elem.name, value: val.replace( rCRLF, "\r\n" ) };
					}) :
					{ name: elem.name, value: val.replace( rCRLF, "\r\n" ) };
		}).get();
	}
});


// Create the request object
// (This is still attached to ajaxSettings for backward compatibility)
jQuery.ajaxSettings.xhr = window.ActiveXObject !== undefined ?
	// Support: IE6+
	function() {

		// XHR cannot access local files, always use ActiveX for that case
		return !this.isLocal &&

			// Support: IE7-8
			// oldIE XHR does not support non-RFC2616 methods (#13240)
			// See http://msdn.microsoft.com/en-us/library/ie/ms536648(v=vs.85).aspx
			// and http://www.w3.org/Protocols/rfc2616/rfc2616-sec9.html#sec9
			// Although this check for six methods instead of eight
			// since IE also does not support "trace" and "connect"
			/^(get|post|head|put|delete|options)$/i.test( this.type ) &&

			createStandardXHR() || createActiveXHR();
	} :
	// For all other browsers, use the standard XMLHttpRequest object
	createStandardXHR;

var xhrId = 0,
	xhrCallbacks = {},
	xhrSupported = jQuery.ajaxSettings.xhr();

// Support: IE<10
// Open requests must be manually aborted on unload (#5280)
// See https://support.microsoft.com/kb/2856746 for more info
if ( window.attachEvent ) {
	window.attachEvent( "onunload", function() {
		for ( var key in xhrCallbacks ) {
			xhrCallbacks[ key ]( undefined, true );
		}
	});
}

// Determine support properties
support.cors = !!xhrSupported && ( "withCredentials" in xhrSupported );
xhrSupported = support.ajax = !!xhrSupported;

// Create transport if the browser can provide an xhr
if ( xhrSupported ) {

	jQuery.ajaxTransport(function( options ) {
		// Cross domain only allowed if supported through XMLHttpRequest
		if ( !options.crossDomain || support.cors ) {

			var callback;

			return {
				send: function( headers, complete ) {
					var i,
						xhr = options.xhr(),
						id = ++xhrId;

					// Open the socket
					xhr.open( options.type, options.url, options.async, options.username, options.password );

					// Apply custom fields if provided
					if ( options.xhrFields ) {
						for ( i in options.xhrFields ) {
							xhr[ i ] = options.xhrFields[ i ];
						}
					}

					// Override mime type if needed
					if ( options.mimeType && xhr.overrideMimeType ) {
						xhr.overrideMimeType( options.mimeType );
					}

					// X-Requested-With header
					// For cross-domain requests, seeing as conditions for a preflight are
					// akin to a jigsaw puzzle, we simply never set it to be sure.
					// (it can always be set on a per-request basis or even using ajaxSetup)
					// For same-domain requests, won't change header if already provided.
					if ( !options.crossDomain && !headers["X-Requested-With"] ) {
						headers["X-Requested-With"] = "XMLHttpRequest";
					}

					// Set headers
					for ( i in headers ) {
						// Support: IE<9
						// IE's ActiveXObject throws a 'Type Mismatch' exception when setting
						// request header to a null-value.
						//
						// To keep consistent with other XHR implementations, cast the value
						// to string and ignore `undefined`.
						if ( headers[ i ] !== undefined ) {
							xhr.setRequestHeader( i, headers[ i ] + "" );
						}
					}

					// Do send the request
					// This may raise an exception which is actually
					// handled in jQuery.ajax (so no try/catch here)
					xhr.send( ( options.hasContent && options.data ) || null );

					// Listener
					callback = function( _, isAbort ) {
						var status, statusText, responses;

						// Was never called and is aborted or complete
						if ( callback && ( isAbort || xhr.readyState === 4 ) ) {
							// Clean up
							delete xhrCallbacks[ id ];
							callback = undefined;
							xhr.onreadystatechange = jQuery.noop;

							// Abort manually if needed
							if ( isAbort ) {
								if ( xhr.readyState !== 4 ) {
									xhr.abort();
								}
							} else {
								responses = {};
								status = xhr.status;

								// Support: IE<10
								// Accessing binary-data responseText throws an exception
								// (#11426)
								if ( typeof xhr.responseText === "string" ) {
									responses.text = xhr.responseText;
								}

								// Firefox throws an exception when accessing
								// statusText for faulty cross-domain requests
								try {
									statusText = xhr.statusText;
								} catch( e ) {
									// We normalize with Webkit giving an empty statusText
									statusText = "";
								}

								// Filter status for non standard behaviors

								// If the request is local and we have data: assume a success
								// (success with no data won't get notified, that's the best we
								// can do given current implementations)
								if ( !status && options.isLocal && !options.crossDomain ) {
									status = responses.text ? 200 : 404;
								// IE - #1450: sometimes returns 1223 when it should be 204
								} else if ( status === 1223 ) {
									status = 204;
								}
							}
						}

						// Call complete if needed
						if ( responses ) {
							complete( status, statusText, responses, xhr.getAllResponseHeaders() );
						}
					};

					if ( !options.async ) {
						// if we're in sync mode we fire the callback
						callback();
					} else if ( xhr.readyState === 4 ) {
						// (IE6 & IE7) if it's in cache and has been
						// retrieved directly we need to fire the callback
						setTimeout( callback );
					} else {
						// Add to the list of active xhr callbacks
						xhr.onreadystatechange = xhrCallbacks[ id ] = callback;
					}
				},

				abort: function() {
					if ( callback ) {
						callback( undefined, true );
					}
				}
			};
		}
	});
}

// Functions to create xhrs
function createStandardXHR() {
	try {
		return new window.XMLHttpRequest();
	} catch( e ) {}
}

function createActiveXHR() {
	try {
		return new window.ActiveXObject( "Microsoft.XMLHTTP" );
	} catch( e ) {}
}




// Install script dataType
jQuery.ajaxSetup({
	accepts: {
		script: "text/javascript, application/javascript, application/ecmascript, application/x-ecmascript"
	},
	contents: {
		script: /(?:java|ecma)script/
	},
	converters: {
		"text script": function( text ) {
			jQuery.globalEval( text );
			return text;
		}
	}
});

// Handle cache's special case and global
jQuery.ajaxPrefilter( "script", function( s ) {
	if ( s.cache === undefined ) {
		s.cache = false;
	}
	if ( s.crossDomain ) {
		s.type = "GET";
		s.global = false;
	}
});

// Bind script tag hack transport
jQuery.ajaxTransport( "script", function(s) {

	// This transport only deals with cross domain requests
	if ( s.crossDomain ) {

		var script,
			head = document.head || jQuery("head")[0] || document.documentElement;

		return {

			send: function( _, callback ) {

				script = document.createElement("script");

				script.async = true;

				if ( s.scriptCharset ) {
					script.charset = s.scriptCharset;
				}

				script.src = s.url;

				// Attach handlers for all browsers
				script.onload = script.onreadystatechange = function( _, isAbort ) {

					if ( isAbort || !script.readyState || /loaded|complete/.test( script.readyState ) ) {

						// Handle memory leak in IE
						script.onload = script.onreadystatechange = null;

						// Remove the script
						if ( script.parentNode ) {
							script.parentNode.removeChild( script );
						}

						// Dereference the script
						script = null;

						// Callback if not abort
						if ( !isAbort ) {
							callback( 200, "success" );
						}
					}
				};

				// Circumvent IE6 bugs with base elements (#2709 and #4378) by prepending
				// Use native DOM manipulation to avoid our domManip AJAX trickery
				head.insertBefore( script, head.firstChild );
			},

			abort: function() {
				if ( script ) {
					script.onload( undefined, true );
				}
			}
		};
	}
});




var oldCallbacks = [],
	rjsonp = /(=)\?(?=&|$)|\?\?/;

// Default jsonp settings
jQuery.ajaxSetup({
	jsonp: "callback",
	jsonpCallback: function() {
		var callback = oldCallbacks.pop() || ( jQuery.expando + "_" + ( nonce++ ) );
		this[ callback ] = true;
		return callback;
	}
});

// Detect, normalize options and install callbacks for jsonp requests
jQuery.ajaxPrefilter( "json jsonp", function( s, originalSettings, jqXHR ) {

	var callbackName, overwritten, responseContainer,
		jsonProp = s.jsonp !== false && ( rjsonp.test( s.url ) ?
			"url" :
			typeof s.data === "string" && !( s.contentType || "" ).indexOf("application/x-www-form-urlencoded") && rjsonp.test( s.data ) && "data"
		);

	// Handle iff the expected data type is "jsonp" or we have a parameter to set
	if ( jsonProp || s.dataTypes[ 0 ] === "jsonp" ) {

		// Get callback name, remembering preexisting value associated with it
		callbackName = s.jsonpCallback = jQuery.isFunction( s.jsonpCallback ) ?
			s.jsonpCallback() :
			s.jsonpCallback;

		// Insert callback into url or form data
		if ( jsonProp ) {
			s[ jsonProp ] = s[ jsonProp ].replace( rjsonp, "$1" + callbackName );
		} else if ( s.jsonp !== false ) {
			s.url += ( rquery.test( s.url ) ? "&" : "?" ) + s.jsonp + "=" + callbackName;
		}

		// Use data converter to retrieve json after script execution
		s.converters["script json"] = function() {
			if ( !responseContainer ) {
				jQuery.error( callbackName + " was not called" );
			}
			return responseContainer[ 0 ];
		};

		// force json dataType
		s.dataTypes[ 0 ] = "json";

		// Install callback
		overwritten = window[ callbackName ];
		window[ callbackName ] = function() {
			responseContainer = arguments;
		};

		// Clean-up function (fires after converters)
		jqXHR.always(function() {
			// Restore preexisting value
			window[ callbackName ] = overwritten;

			// Save back as free
			if ( s[ callbackName ] ) {
				// make sure that re-using the options doesn't screw things around
				s.jsonpCallback = originalSettings.jsonpCallback;

				// save the callback name for future use
				oldCallbacks.push( callbackName );
			}

			// Call if it was a function and we have a response
			if ( responseContainer && jQuery.isFunction( overwritten ) ) {
				overwritten( responseContainer[ 0 ] );
			}

			responseContainer = overwritten = undefined;
		});

		// Delegate to script
		return "script";
	}
});




// data: string of html
// context (optional): If specified, the fragment will be created in this context, defaults to document
// keepScripts (optional): If true, will include scripts passed in the html string
jQuery.parseHTML = function( data, context, keepScripts ) {
	if ( !data || typeof data !== "string" ) {
		return null;
	}
	if ( typeof context === "boolean" ) {
		keepScripts = context;
		context = false;
	}
	context = context || document;

	var parsed = rsingleTag.exec( data ),
		scripts = !keepScripts && [];

	// Single tag
	if ( parsed ) {
		return [ context.createElement( parsed[1] ) ];
	}

	parsed = jQuery.buildFragment( [ data ], context, scripts );

	if ( scripts && scripts.length ) {
		jQuery( scripts ).remove();
	}

	return jQuery.merge( [], parsed.childNodes );
};


// Keep a copy of the old load method
var _load = jQuery.fn.load;

/**
 * Load a url into a page
 */
jQuery.fn.load = function( url, params, callback ) {
	if ( typeof url !== "string" && _load ) {
		return _load.apply( this, arguments );
	}

	var selector, response, type,
		self = this,
		off = url.indexOf(" ");

	if ( off >= 0 ) {
		selector = jQuery.trim( url.slice( off, url.length ) );
		url = url.slice( 0, off );
	}

	// If it's a function
	if ( jQuery.isFunction( params ) ) {

		// We assume that it's the callback
		callback = params;
		params = undefined;

	// Otherwise, build a param string
	} else if ( params && typeof params === "object" ) {
		type = "POST";
	}

	// If we have elements to modify, make the request
	if ( self.length > 0 ) {
		jQuery.ajax({
			url: url,

			// if "type" variable is undefined, then "GET" method will be used
			type: type,
			dataType: "html",
			data: params
		}).done(function( responseText ) {

			// Save response for use in complete callback
			response = arguments;

			self.html( selector ?

				// If a selector was specified, locate the right elements in a dummy div
				// Exclude scripts to avoid IE 'Permission Denied' errors
				jQuery("<div>").append( jQuery.parseHTML( responseText ) ).find( selector ) :

				// Otherwise use the full result
				responseText );

		}).complete( callback && function( jqXHR, status ) {
			self.each( callback, response || [ jqXHR.responseText, status, jqXHR ] );
		});
	}

	return this;
};




// Attach a bunch of functions for handling common AJAX events
jQuery.each( [ "ajaxStart", "ajaxStop", "ajaxComplete", "ajaxError", "ajaxSuccess", "ajaxSend" ], function( i, type ) {
	jQuery.fn[ type ] = function( fn ) {
		return this.on( type, fn );
	};
});




jQuery.expr.filters.animated = function( elem ) {
	return jQuery.grep(jQuery.timers, function( fn ) {
		return elem === fn.elem;
	}).length;
};





var docElem = window.document.documentElement;

/**
 * Gets a window from an element
 */
function getWindow( elem ) {
	return jQuery.isWindow( elem ) ?
		elem :
		elem.nodeType === 9 ?
			elem.defaultView || elem.parentWindow :
			false;
}

jQuery.offset = {
	setOffset: function( elem, options, i ) {
		var curPosition, curLeft, curCSSTop, curTop, curOffset, curCSSLeft, calculatePosition,
			position = jQuery.css( elem, "position" ),
			curElem = jQuery( elem ),
			props = {};

		// set position first, in-case top/left are set even on static elem
		if ( position === "static" ) {
			elem.style.position = "relative";
		}

		curOffset = curElem.offset();
		curCSSTop = jQuery.css( elem, "top" );
		curCSSLeft = jQuery.css( elem, "left" );
		calculatePosition = ( position === "absolute" || position === "fixed" ) &&
			jQuery.inArray("auto", [ curCSSTop, curCSSLeft ] ) > -1;

		// need to be able to calculate position if either top or left is auto and position is either absolute or fixed
		if ( calculatePosition ) {
			curPosition = curElem.position();
			curTop = curPosition.top;
			curLeft = curPosition.left;
		} else {
			curTop = parseFloat( curCSSTop ) || 0;
			curLeft = parseFloat( curCSSLeft ) || 0;
		}

		if ( jQuery.isFunction( options ) ) {
			options = options.call( elem, i, curOffset );
		}

		if ( options.top != null ) {
			props.top = ( options.top - curOffset.top ) + curTop;
		}
		if ( options.left != null ) {
			props.left = ( options.left - curOffset.left ) + curLeft;
		}

		if ( "using" in options ) {
			options.using.call( elem, props );
		} else {
			curElem.css( props );
		}
	}
};

jQuery.fn.extend({
	offset: function( options ) {
		if ( arguments.length ) {
			return options === undefined ?
				this :
				this.each(function( i ) {
					jQuery.offset.setOffset( this, options, i );
				});
		}

		var docElem, win,
			box = { top: 0, left: 0 },
			elem = this[ 0 ],
			doc = elem && elem.ownerDocument;

		if ( !doc ) {
			return;
		}

		docElem = doc.documentElement;

		// Make sure it's not a disconnected DOM node
		if ( !jQuery.contains( docElem, elem ) ) {
			return box;
		}

		// If we don't have gBCR, just use 0,0 rather than error
		// BlackBerry 5, iOS 3 (original iPhone)
		if ( typeof elem.getBoundingClientRect !== strundefined ) {
			box = elem.getBoundingClientRect();
		}
		win = getWindow( doc );
		return {
			top: box.top  + ( win.pageYOffset || docElem.scrollTop )  - ( docElem.clientTop  || 0 ),
			left: box.left + ( win.pageXOffset || docElem.scrollLeft ) - ( docElem.clientLeft || 0 )
		};
	},

	position: function() {
		if ( !this[ 0 ] ) {
			return;
		}

		var offsetParent, offset,
			parentOffset = { top: 0, left: 0 },
			elem = this[ 0 ];

		// fixed elements are offset from window (parentOffset = {top:0, left: 0}, because it is its only offset parent
		if ( jQuery.css( elem, "position" ) === "fixed" ) {
			// we assume that getBoundingClientRect is available when computed position is fixed
			offset = elem.getBoundingClientRect();
		} else {
			// Get *real* offsetParent
			offsetParent = this.offsetParent();

			// Get correct offsets
			offset = this.offset();
			if ( !jQuery.nodeName( offsetParent[ 0 ], "html" ) ) {
				parentOffset = offsetParent.offset();
			}

			// Add offsetParent borders
			parentOffset.top  += jQuery.css( offsetParent[ 0 ], "borderTopWidth", true );
			parentOffset.left += jQuery.css( offsetParent[ 0 ], "borderLeftWidth", true );
		}

		// Subtract parent offsets and element margins
		// note: when an element has margin: auto the offsetLeft and marginLeft
		// are the same in Safari causing offset.left to incorrectly be 0
		return {
			top:  offset.top  - parentOffset.top - jQuery.css( elem, "marginTop", true ),
			left: offset.left - parentOffset.left - jQuery.css( elem, "marginLeft", true)
		};
	},

	offsetParent: function() {
		return this.map(function() {
			var offsetParent = this.offsetParent || docElem;

			while ( offsetParent && ( !jQuery.nodeName( offsetParent, "html" ) && jQuery.css( offsetParent, "position" ) === "static" ) ) {
				offsetParent = offsetParent.offsetParent;
			}
			return offsetParent || docElem;
		});
	}
});

// Create scrollLeft and scrollTop methods
jQuery.each( { scrollLeft: "pageXOffset", scrollTop: "pageYOffset" }, function( method, prop ) {
	var top = /Y/.test( prop );

	jQuery.fn[ method ] = function( val ) {
		return access( this, function( elem, method, val ) {
			var win = getWindow( elem );

			if ( val === undefined ) {
				return win ? (prop in win) ? win[ prop ] :
					win.document.documentElement[ method ] :
					elem[ method ];
			}

			if ( win ) {
				win.scrollTo(
					!top ? val : jQuery( win ).scrollLeft(),
					top ? val : jQuery( win ).scrollTop()
				);

			} else {
				elem[ method ] = val;
			}
		}, method, val, arguments.length, null );
	};
});

// Add the top/left cssHooks using jQuery.fn.position
// Webkit bug: https://bugs.webkit.org/show_bug.cgi?id=29084
// getComputedStyle returns percent when specified for top/left/bottom/right
// rather than make the css module depend on the offset module, we just check for it here
jQuery.each( [ "top", "left" ], function( i, prop ) {
	jQuery.cssHooks[ prop ] = addGetHookIf( support.pixelPosition,
		function( elem, computed ) {
			if ( computed ) {
				computed = curCSS( elem, prop );
				// if curCSS returns percentage, fallback to offset
				return rnumnonpx.test( computed ) ?
					jQuery( elem ).position()[ prop ] + "px" :
					computed;
			}
		}
	);
});


// Create innerHeight, innerWidth, height, width, outerHeight and outerWidth methods
jQuery.each( { Height: "height", Width: "width" }, function( name, type ) {
	jQuery.each( { padding: "inner" + name, content: type, "": "outer" + name }, function( defaultExtra, funcName ) {
		// margin is only for outerHeight, outerWidth
		jQuery.fn[ funcName ] = function( margin, value ) {
			var chainable = arguments.length && ( defaultExtra || typeof margin !== "boolean" ),
				extra = defaultExtra || ( margin === true || value === true ? "margin" : "border" );

			return access( this, function( elem, type, value ) {
				var doc;

				if ( jQuery.isWindow( elem ) ) {
					// As of 5/8/2012 this will yield incorrect results for Mobile Safari, but there
					// isn't a whole lot we can do. See pull request at this URL for discussion:
					// https://github.com/jquery/jquery/pull/764
					return elem.document.documentElement[ "client" + name ];
				}

				// Get document width or height
				if ( elem.nodeType === 9 ) {
					doc = elem.documentElement;

					// Either scroll[Width/Height] or offset[Width/Height] or client[Width/Height], whichever is greatest
					// unfortunately, this causes bug #3838 in IE6/8 only, but there is currently no good, small way to fix it.
					return Math.max(
						elem.body[ "scroll" + name ], doc[ "scroll" + name ],
						elem.body[ "offset" + name ], doc[ "offset" + name ],
						doc[ "client" + name ]
					);
				}

				return value === undefined ?
					// Get width or height on the element, requesting but not forcing parseFloat
					jQuery.css( elem, type, extra ) :

					// Set width or height on the element
					jQuery.style( elem, type, value, extra );
			}, type, chainable ? margin : undefined, chainable, null );
		};
	});
});


// The number of elements contained in the matched element set
jQuery.fn.size = function() {
	return this.length;
};

jQuery.fn.andSelf = jQuery.fn.addBack;




// Register as a named AMD module, since jQuery can be concatenated with other
// files that may use define, but not via a proper concatenation script that
// understands anonymous AMD modules. A named AMD is safest and most robust
// way to register. Lowercase jquery is used because AMD module names are
// derived from file names, and jQuery is normally delivered in a lowercase
// file name. Do this after creating the global so that if an AMD module wants
// to call noConflict to hide this version of jQuery, it will work.

// Note that for maximum portability, libraries that are not jQuery should
// declare themselves as anonymous modules, and avoid setting a global if an
// AMD loader is present. jQuery is a special case. For more information, see
// https://github.com/jrburke/requirejs/wiki/Updating-existing-libraries#wiki-anon

if ( typeof define === "function" && define.amd ) {
	define( "jquery", [], function() {
		return jQuery;
	});
}




var
	// Map over jQuery in case of overwrite
	_jQuery = window.jQuery,

	// Map over the $ in case of overwrite
	_$ = window.$;

jQuery.noConflict = function( deep ) {
	if ( window.$ === jQuery ) {
		window.$ = _$;
	}

	if ( deep && window.jQuery === jQuery ) {
		window.jQuery = _jQuery;
	}

	return jQuery;
};

// Expose jQuery and $ identifiers, even in
// AMD (#7102#comment:10, https://github.com/jquery/jquery/pull/557)
// and CommonJS for browser emulators (#13566)
if ( typeof noGlobal === strundefined ) {
	window.jQuery = window.$ = jQuery;
}




return jQuery;

}));

/*!
 * Bootstrap v3.3.4 (http://getbootstrap.com)
 * Copyright 2011-2015 Twitter, Inc.
 * Licensed under MIT (https://github.com/twbs/bootstrap/blob/master/LICENSE)
 */

if (typeof jQuery === 'undefined') {
  throw new Error('Bootstrap\'s JavaScript requires jQuery')
}

+function ($) {
  'use strict';
  var version = $.fn.jquery.split(' ')[0].split('.')
  if ((version[0] < 2 && version[1] < 9) || (version[0] == 1 && version[1] == 9 && version[2] < 1)) {
    throw new Error('Bootstrap\'s JavaScript requires jQuery version 1.9.1 or higher')
  }
}(jQuery);

/* ========================================================================
 * Bootstrap: transition.js v3.3.4
 * http://getbootstrap.com/javascript/#transitions
 * ========================================================================
 * Copyright 2011-2015 Twitter, Inc.
 * Licensed under MIT (https://github.com/twbs/bootstrap/blob/master/LICENSE)
 * ======================================================================== */


+function ($) {
  'use strict';

  // CSS TRANSITION SUPPORT (Shoutout: http://www.modernizr.com/)
  // ============================================================

  function transitionEnd() {
    var el = document.createElement('bootstrap')

    var transEndEventNames = {
      WebkitTransition : 'webkitTransitionEnd',
      MozTransition    : 'transitionend',
      OTransition      : 'oTransitionEnd otransitionend',
      transition       : 'transitionend'
    }

    for (var name in transEndEventNames) {
      if (el.style[name] !== undefined) {
        return { end: transEndEventNames[name] }
      }
    }

    return false // explicit for ie8 (  ._.)
  }

  // http://blog.alexmaccaw.com/css-transitions
  $.fn.emulateTransitionEnd = function (duration) {
    var called = false
    var $el = this
    $(this).one('bsTransitionEnd', function () { called = true })
    var callback = function () { if (!called) $($el).trigger($.support.transition.end) }
    setTimeout(callback, duration)
    return this
  }

  $(function () {
    $.support.transition = transitionEnd()

    if (!$.support.transition) return

    $.event.special.bsTransitionEnd = {
      bindType: $.support.transition.end,
      delegateType: $.support.transition.end,
      handle: function (e) {
        if ($(e.target).is(this)) return e.handleObj.handler.apply(this, arguments)
      }
    }
  })

}(jQuery);

/* ========================================================================
 * Bootstrap: alert.js v3.3.4
 * http://getbootstrap.com/javascript/#alerts
 * ========================================================================
 * Copyright 2011-2015 Twitter, Inc.
 * Licensed under MIT (https://github.com/twbs/bootstrap/blob/master/LICENSE)
 * ======================================================================== */


+function ($) {
  'use strict';

  // ALERT CLASS DEFINITION
  // ======================

  var dismiss = '[data-dismiss="alert"]'
  var Alert   = function (el) {
    $(el).on('click', dismiss, this.close)
  }

  Alert.VERSION = '3.3.4'

  Alert.TRANSITION_DURATION = 150

  Alert.prototype.close = function (e) {
    var $this    = $(this)
    var selector = $this.attr('data-target')

    if (!selector) {
      selector = $this.attr('href')
      selector = selector && selector.replace(/.*(?=#[^\s]*$)/, '') // strip for ie7
    }

    var $parent = $(selector)

    if (e) e.preventDefault()

    if (!$parent.length) {
      $parent = $this.closest('.alert')
    }

    $parent.trigger(e = $.Event('close.bs.alert'))

    if (e.isDefaultPrevented()) return

    $parent.removeClass('in')

    function removeElement() {
      // detach from parent, fire event then clean up data
      $parent.detach().trigger('closed.bs.alert').remove()
    }

    $.support.transition && $parent.hasClass('fade') ?
      $parent
        .one('bsTransitionEnd', removeElement)
        .emulateTransitionEnd(Alert.TRANSITION_DURATION) :
      removeElement()
  }


  // ALERT PLUGIN DEFINITION
  // =======================

  function Plugin(option) {
    return this.each(function () {
      var $this = $(this)
      var data  = $this.data('bs.alert')

      if (!data) $this.data('bs.alert', (data = new Alert(this)))
      if (typeof option == 'string') data[option].call($this)
    })
  }

  var old = $.fn.alert

  $.fn.alert             = Plugin
  $.fn.alert.Constructor = Alert


  // ALERT NO CONFLICT
  // =================

  $.fn.alert.noConflict = function () {
    $.fn.alert = old
    return this
  }


  // ALERT DATA-API
  // ==============

  $(document).on('click.bs.alert.data-api', dismiss, Alert.prototype.close)

}(jQuery);

/* ========================================================================
 * Bootstrap: button.js v3.3.4
 * http://getbootstrap.com/javascript/#buttons
 * ========================================================================
 * Copyright 2011-2015 Twitter, Inc.
 * Licensed under MIT (https://github.com/twbs/bootstrap/blob/master/LICENSE)
 * ======================================================================== */


+function ($) {
  'use strict';

  // BUTTON PUBLIC CLASS DEFINITION
  // ==============================

  var Button = function (element, options) {
    this.$element  = $(element)
    this.options   = $.extend({}, Button.DEFAULTS, options)
    this.isLoading = false
  }

  Button.VERSION  = '3.3.4'

  Button.DEFAULTS = {
    loadingText: 'loading...'
  }

  Button.prototype.setState = function (state) {
    var d    = 'disabled'
    var $el  = this.$element
    var val  = $el.is('input') ? 'val' : 'html'
    var data = $el.data()

    state = state + 'Text'

    if (data.resetText == null) $el.data('resetText', $el[val]())

    // push to event loop to allow forms to submit
    setTimeout($.proxy(function () {
      $el[val](data[state] == null ? this.options[state] : data[state])

      if (state == 'loadingText') {
        this.isLoading = true
        $el.addClass(d).attr(d, d)
      } else if (this.isLoading) {
        this.isLoading = false
        $el.removeClass(d).removeAttr(d)
      }
    }, this), 0)
  }

  Button.prototype.toggle = function () {
    var changed = true
    var $parent = this.$element.closest('[data-toggle="buttons"]')

    if ($parent.length) {
      var $input = this.$element.find('input')
      if ($input.prop('type') == 'radio') {
        if ($input.prop('checked') && this.$element.hasClass('active')) changed = false
        else $parent.find('.active').removeClass('active')
      }
      if (changed) $input.prop('checked', !this.$element.hasClass('active')).trigger('change')
    } else {
      this.$element.attr('aria-pressed', !this.$element.hasClass('active'))
    }

    if (changed) this.$element.toggleClass('active')
  }


  // BUTTON PLUGIN DEFINITION
  // ========================

  function Plugin(option) {
    return this.each(function () {
      var $this   = $(this)
      var data    = $this.data('bs.button')
      var options = typeof option == 'object' && option

      if (!data) $this.data('bs.button', (data = new Button(this, options)))

      if (option == 'toggle') data.toggle()
      else if (option) data.setState(option)
    })
  }

  var old = $.fn.button

  $.fn.button             = Plugin
  $.fn.button.Constructor = Button


  // BUTTON NO CONFLICT
  // ==================

  $.fn.button.noConflict = function () {
    $.fn.button = old
    return this
  }


  // BUTTON DATA-API
  // ===============

  $(document)
    .on('click.bs.button.data-api', '[data-toggle^="button"]', function (e) {
      var $btn = $(e.target)
      if (!$btn.hasClass('btn')) $btn = $btn.closest('.btn')
      Plugin.call($btn, 'toggle')
      e.preventDefault()
    })
    .on('focus.bs.button.data-api blur.bs.button.data-api', '[data-toggle^="button"]', function (e) {
      $(e.target).closest('.btn').toggleClass('focus', /^focus(in)?$/.test(e.type))
    })

}(jQuery);

/* ========================================================================
 * Bootstrap: carousel.js v3.3.4
 * http://getbootstrap.com/javascript/#carousel
 * ========================================================================
 * Copyright 2011-2015 Twitter, Inc.
 * Licensed under MIT (https://github.com/twbs/bootstrap/blob/master/LICENSE)
 * ======================================================================== */


+function ($) {
  'use strict';

  // CAROUSEL CLASS DEFINITION
  // =========================

  var Carousel = function (element, options) {
    this.$element    = $(element)
    this.$indicators = this.$element.find('.carousel-indicators')
    this.options     = options
    this.paused      = null
    this.sliding     = null
    this.interval    = null
    this.$active     = null
    this.$items      = null

    this.options.keyboard && this.$element.on('keydown.bs.carousel', $.proxy(this.keydown, this))

    this.options.pause == 'hover' && !('ontouchstart' in document.documentElement) && this.$element
      .on('mouseenter.bs.carousel', $.proxy(this.pause, this))
      .on('mouseleave.bs.carousel', $.proxy(this.cycle, this))
  }

  Carousel.VERSION  = '3.3.4'

  Carousel.TRANSITION_DURATION = 600

  Carousel.DEFAULTS = {
    interval: 5000,
    pause: 'hover',
    wrap: true,
    keyboard: true
  }

  Carousel.prototype.keydown = function (e) {
    if (/input|textarea/i.test(e.target.tagName)) return
    switch (e.which) {
      case 37: this.prev(); break
      case 39: this.next(); break
      default: return
    }

    e.preventDefault()
  }

  Carousel.prototype.cycle = function (e) {
    e || (this.paused = false)

    this.interval && clearInterval(this.interval)

    this.options.interval
      && !this.paused
      && (this.interval = setInterval($.proxy(this.next, this), this.options.interval))

    return this
  }

  Carousel.prototype.getItemIndex = function (item) {
    this.$items = item.parent().children('.item')
    return this.$items.index(item || this.$active)
  }

  Carousel.prototype.getItemForDirection = function (direction, active) {
    var activeIndex = this.getItemIndex(active)
    var willWrap = (direction == 'prev' && activeIndex === 0)
                || (direction == 'next' && activeIndex == (this.$items.length - 1))
    if (willWrap && !this.options.wrap) return active
    var delta = direction == 'prev' ? -1 : 1
    var itemIndex = (activeIndex + delta) % this.$items.length
    return this.$items.eq(itemIndex)
  }

  Carousel.prototype.to = function (pos) {
    var that        = this
    var activeIndex = this.getItemIndex(this.$active = this.$element.find('.item.active'))

    if (pos > (this.$items.length - 1) || pos < 0) return

    if (this.sliding)       return this.$element.one('slid.bs.carousel', function () { that.to(pos) }) // yes, "slid"
    if (activeIndex == pos) return this.pause().cycle()

    return this.slide(pos > activeIndex ? 'next' : 'prev', this.$items.eq(pos))
  }

  Carousel.prototype.pause = function (e) {
    e || (this.paused = true)

    if (this.$element.find('.next, .prev').length && $.support.transition) {
      this.$element.trigger($.support.transition.end)
      this.cycle(true)
    }

    this.interval = clearInterval(this.interval)

    return this
  }

  Carousel.prototype.next = function () {
    if (this.sliding) return
    return this.slide('next')
  }

  Carousel.prototype.prev = function () {
    if (this.sliding) return
    return this.slide('prev')
  }

  Carousel.prototype.slide = function (type, next) {
    var $active   = this.$element.find('.item.active')
    var $next     = next || this.getItemForDirection(type, $active)
    var isCycling = this.interval
    var direction = type == 'next' ? 'left' : 'right'
    var that      = this

    if ($next.hasClass('active')) return (this.sliding = false)

    var relatedTarget = $next[0]
    var slideEvent = $.Event('slide.bs.carousel', {
      relatedTarget: relatedTarget,
      direction: direction
    })
    this.$element.trigger(slideEvent)
    if (slideEvent.isDefaultPrevented()) return

    this.sliding = true

    isCycling && this.pause()

    if (this.$indicators.length) {
      this.$indicators.find('.active').removeClass('active')
      var $nextIndicator = $(this.$indicators.children()[this.getItemIndex($next)])
      $nextIndicator && $nextIndicator.addClass('active')
    }

    var slidEvent = $.Event('slid.bs.carousel', { relatedTarget: relatedTarget, direction: direction }) // yes, "slid"
    if ($.support.transition && this.$element.hasClass('slide')) {
      $next.addClass(type)
      $next[0].offsetWidth // force reflow
      $active.addClass(direction)
      $next.addClass(direction)
      $active
        .one('bsTransitionEnd', function () {
          $next.removeClass([type, direction].join(' ')).addClass('active')
          $active.removeClass(['active', direction].join(' '))
          that.sliding = false
          setTimeout(function () {
            that.$element.trigger(slidEvent)
          }, 0)
        })
        .emulateTransitionEnd(Carousel.TRANSITION_DURATION)
    } else {
      $active.removeClass('active')
      $next.addClass('active')
      this.sliding = false
      this.$element.trigger(slidEvent)
    }

    isCycling && this.cycle()

    return this
  }


  // CAROUSEL PLUGIN DEFINITION
  // ==========================

  function Plugin(option) {
    return this.each(function () {
      var $this   = $(this)
      var data    = $this.data('bs.carousel')
      var options = $.extend({}, Carousel.DEFAULTS, $this.data(), typeof option == 'object' && option)
      var action  = typeof option == 'string' ? option : options.slide

      if (!data) $this.data('bs.carousel', (data = new Carousel(this, options)))
      if (typeof option == 'number') data.to(option)
      else if (action) data[action]()
      else if (options.interval) data.pause().cycle()
    })
  }

  var old = $.fn.carousel

  $.fn.carousel             = Plugin
  $.fn.carousel.Constructor = Carousel


  // CAROUSEL NO CONFLICT
  // ====================

  $.fn.carousel.noConflict = function () {
    $.fn.carousel = old
    return this
  }


  // CAROUSEL DATA-API
  // =================

  var clickHandler = function (e) {
    var href
    var $this   = $(this)
    var $target = $($this.attr('data-target') || (href = $this.attr('href')) && href.replace(/.*(?=#[^\s]+$)/, '')) // strip for ie7
    if (!$target.hasClass('carousel')) return
    var options = $.extend({}, $target.data(), $this.data())
    var slideIndex = $this.attr('data-slide-to')
    if (slideIndex) options.interval = false

    Plugin.call($target, options)

    if (slideIndex) {
      $target.data('bs.carousel').to(slideIndex)
    }

    e.preventDefault()
  }

  $(document)
    .on('click.bs.carousel.data-api', '[data-slide]', clickHandler)
    .on('click.bs.carousel.data-api', '[data-slide-to]', clickHandler)

  $(window).on('load', function () {
    $('[data-ride="carousel"]').each(function () {
      var $carousel = $(this)
      Plugin.call($carousel, $carousel.data())
    })
  })

}(jQuery);

/* ========================================================================
 * Bootstrap: collapse.js v3.3.4
 * http://getbootstrap.com/javascript/#collapse
 * ========================================================================
 * Copyright 2011-2015 Twitter, Inc.
 * Licensed under MIT (https://github.com/twbs/bootstrap/blob/master/LICENSE)
 * ======================================================================== */


+function ($) {
  'use strict';

  // COLLAPSE PUBLIC CLASS DEFINITION
  // ================================

  var Collapse = function (element, options) {
    this.$element      = $(element)
    this.options       = $.extend({}, Collapse.DEFAULTS, options)
    this.$trigger      = $('[data-toggle="collapse"][href="#' + element.id + '"],' +
                           '[data-toggle="collapse"][data-target="#' + element.id + '"]')
    this.transitioning = null

    if (this.options.parent) {
      this.$parent = this.getParent()
    } else {
      this.addAriaAndCollapsedClass(this.$element, this.$trigger)
    }

    if (this.options.toggle) this.toggle()
  }

  Collapse.VERSION  = '3.3.4'

  Collapse.TRANSITION_DURATION = 350

  Collapse.DEFAULTS = {
    toggle: true
  }

  Collapse.prototype.dimension = function () {
    var hasWidth = this.$element.hasClass('width')
    return hasWidth ? 'width' : 'height'
  }

  Collapse.prototype.show = function () {
    if (this.transitioning || this.$element.hasClass('in')) return

    var activesData
    var actives = this.$parent && this.$parent.children('.panel').children('.in, .collapsing')

    if (actives && actives.length) {
      activesData = actives.data('bs.collapse')
      if (activesData && activesData.transitioning) return
    }

    var startEvent = $.Event('show.bs.collapse')
    this.$element.trigger(startEvent)
    if (startEvent.isDefaultPrevented()) return

    if (actives && actives.length) {
      Plugin.call(actives, 'hide')
      activesData || actives.data('bs.collapse', null)
    }

    var dimension = this.dimension()

    this.$element
      .removeClass('collapse')
      .addClass('collapsing')[dimension](0)
      .attr('aria-expanded', true)

    this.$trigger
      .removeClass('collapsed')
      .attr('aria-expanded', true)

    this.transitioning = 1

    var complete = function () {
      this.$element
        .removeClass('collapsing')
        .addClass('collapse in')[dimension]('')
      this.transitioning = 0
      this.$element
        .trigger('shown.bs.collapse')
    }

    if (!$.support.transition) return complete.call(this)

    var scrollSize = $.camelCase(['scroll', dimension].join('-'))

    this.$element
      .one('bsTransitionEnd', $.proxy(complete, this))
      .emulateTransitionEnd(Collapse.TRANSITION_DURATION)[dimension](this.$element[0][scrollSize])
  }

  Collapse.prototype.hide = function () {
    if (this.transitioning || !this.$element.hasClass('in')) return

    var startEvent = $.Event('hide.bs.collapse')
    this.$element.trigger(startEvent)
    if (startEvent.isDefaultPrevented()) return

    var dimension = this.dimension()

    this.$element[dimension](this.$element[dimension]())[0].offsetHeight

    this.$element
      .addClass('collapsing')
      .removeClass('collapse in')
      .attr('aria-expanded', false)

    this.$trigger
      .addClass('collapsed')
      .attr('aria-expanded', false)

    this.transitioning = 1

    var complete = function () {
      this.transitioning = 0
      this.$element
        .removeClass('collapsing')
        .addClass('collapse')
        .trigger('hidden.bs.collapse')
    }

    if (!$.support.transition) return complete.call(this)

    this.$element
      [dimension](0)
      .one('bsTransitionEnd', $.proxy(complete, this))
      .emulateTransitionEnd(Collapse.TRANSITION_DURATION)
  }

  Collapse.prototype.toggle = function () {
    this[this.$element.hasClass('in') ? 'hide' : 'show']()
  }

  Collapse.prototype.getParent = function () {
    return $(this.options.parent)
      .find('[data-toggle="collapse"][data-parent="' + this.options.parent + '"]')
      .each($.proxy(function (i, element) {
        var $element = $(element)
        this.addAriaAndCollapsedClass(getTargetFromTrigger($element), $element)
      }, this))
      .end()
  }

  Collapse.prototype.addAriaAndCollapsedClass = function ($element, $trigger) {
    var isOpen = $element.hasClass('in')

    $element.attr('aria-expanded', isOpen)
    $trigger
      .toggleClass('collapsed', !isOpen)
      .attr('aria-expanded', isOpen)
  }

  function getTargetFromTrigger($trigger) {
    var href
    var target = $trigger.attr('data-target')
      || (href = $trigger.attr('href')) && href.replace(/.*(?=#[^\s]+$)/, '') // strip for ie7

    return $(target)
  }


  // COLLAPSE PLUGIN DEFINITION
  // ==========================

  function Plugin(option) {
    return this.each(function () {
      var $this   = $(this)
      var data    = $this.data('bs.collapse')
      var options = $.extend({}, Collapse.DEFAULTS, $this.data(), typeof option == 'object' && option)

      if (!data && options.toggle && /show|hide/.test(option)) options.toggle = false
      if (!data) $this.data('bs.collapse', (data = new Collapse(this, options)))
      if (typeof option == 'string') data[option]()
    })
  }

  var old = $.fn.collapse

  $.fn.collapse             = Plugin
  $.fn.collapse.Constructor = Collapse


  // COLLAPSE NO CONFLICT
  // ====================

  $.fn.collapse.noConflict = function () {
    $.fn.collapse = old
    return this
  }


  // COLLAPSE DATA-API
  // =================

  $(document).on('click.bs.collapse.data-api', '[data-toggle="collapse"]', function (e) {
    var $this   = $(this)

    if (!$this.attr('data-target')) e.preventDefault()

    var $target = getTargetFromTrigger($this)
    var data    = $target.data('bs.collapse')
    var option  = data ? 'toggle' : $this.data()

    Plugin.call($target, option)
  })

}(jQuery);

/* ========================================================================
 * Bootstrap: dropdown.js v3.3.4
 * http://getbootstrap.com/javascript/#dropdowns
 * ========================================================================
 * Copyright 2011-2015 Twitter, Inc.
 * Licensed under MIT (https://github.com/twbs/bootstrap/blob/master/LICENSE)
 * ======================================================================== */


+function ($) {
  'use strict';

  // DROPDOWN CLASS DEFINITION
  // =========================

  var backdrop = '.dropdown-backdrop'
  var toggle   = '[data-toggle="dropdown"]'
  var Dropdown = function (element) {
    $(element).on('click.bs.dropdown', this.toggle)
  }

  Dropdown.VERSION = '3.3.4'

  Dropdown.prototype.toggle = function (e) {
    var $this = $(this)

    if ($this.is('.disabled, :disabled')) return

    var $parent  = getParent($this)
    var isActive = $parent.hasClass('open')

    clearMenus()

    if (!isActive) {
      if ('ontouchstart' in document.documentElement && !$parent.closest('.navbar-nav').length) {
        // if mobile we use a backdrop because click events don't delegate
        $('<div class="dropdown-backdrop"/>').insertAfter($(this)).on('click', clearMenus)
      }

      var relatedTarget = { relatedTarget: this }
      $parent.trigger(e = $.Event('show.bs.dropdown', relatedTarget))

      if (e.isDefaultPrevented()) return

      $this
        .trigger('focus')
        .attr('aria-expanded', 'true')

      $parent
        .toggleClass('open')
        .trigger('shown.bs.dropdown', relatedTarget)
    }

    return false
  }

  Dropdown.prototype.keydown = function (e) {
    if (!/(38|40|27|32)/.test(e.which) || /input|textarea/i.test(e.target.tagName)) return

    var $this = $(this)

    e.preventDefault()
    e.stopPropagation()

    if ($this.is('.disabled, :disabled')) return

    var $parent  = getParent($this)
    var isActive = $parent.hasClass('open')

    if ((!isActive && e.which != 27) || (isActive && e.which == 27)) {
      if (e.which == 27) $parent.find(toggle).trigger('focus')
      return $this.trigger('click')
    }

    var desc = ' li:not(.disabled):visible a'
    var $items = $parent.find('[role="menu"]' + desc + ', [role="listbox"]' + desc)

    if (!$items.length) return

    var index = $items.index(e.target)

    if (e.which == 38 && index > 0)                 index--                        // up
    if (e.which == 40 && index < $items.length - 1) index++                        // down
    if (!~index)                                      index = 0

    $items.eq(index).trigger('focus')
  }

  function clearMenus(e) {
    if (e && e.which === 3) return
    $(backdrop).remove()
    $(toggle).each(function () {
      var $this         = $(this)
      var $parent       = getParent($this)
      var relatedTarget = { relatedTarget: this }

      if (!$parent.hasClass('open')) return

      $parent.trigger(e = $.Event('hide.bs.dropdown', relatedTarget))

      if (e.isDefaultPrevented()) return

      $this.attr('aria-expanded', 'false')
      $parent.removeClass('open').trigger('hidden.bs.dropdown', relatedTarget)
    })
  }

  function getParent($this) {
    var selector = $this.attr('data-target')

    if (!selector) {
      selector = $this.attr('href')
      selector = selector && /#[A-Za-z]/.test(selector) && selector.replace(/.*(?=#[^\s]*$)/, '') // strip for ie7
    }

    var $parent = selector && $(selector)

    return $parent && $parent.length ? $parent : $this.parent()
  }


  // DROPDOWN PLUGIN DEFINITION
  // ==========================

  function Plugin(option) {
    return this.each(function () {
      var $this = $(this)
      var data  = $this.data('bs.dropdown')

      if (!data) $this.data('bs.dropdown', (data = new Dropdown(this)))
      if (typeof option == 'string') data[option].call($this)
    })
  }

  var old = $.fn.dropdown

  $.fn.dropdown             = Plugin
  $.fn.dropdown.Constructor = Dropdown


  // DROPDOWN NO CONFLICT
  // ====================

  $.fn.dropdown.noConflict = function () {
    $.fn.dropdown = old
    return this
  }


  // APPLY TO STANDARD DROPDOWN ELEMENTS
  // ===================================

  $(document)
    .on('click.bs.dropdown.data-api', clearMenus)
    .on('click.bs.dropdown.data-api', '.dropdown form', function (e) { e.stopPropagation() })
    .on('click.bs.dropdown.data-api', toggle, Dropdown.prototype.toggle)
    .on('keydown.bs.dropdown.data-api', toggle, Dropdown.prototype.keydown)
    .on('keydown.bs.dropdown.data-api', '[role="menu"]', Dropdown.prototype.keydown)
    .on('keydown.bs.dropdown.data-api', '[role="listbox"]', Dropdown.prototype.keydown)

}(jQuery);

/* ========================================================================
 * Bootstrap: modal.js v3.3.4
 * http://getbootstrap.com/javascript/#modals
 * ========================================================================
 * Copyright 2011-2015 Twitter, Inc.
 * Licensed under MIT (https://github.com/twbs/bootstrap/blob/master/LICENSE)
 * ======================================================================== */


+function ($) {
  'use strict';

  // MODAL CLASS DEFINITION
  // ======================

  var Modal = function (element, options) {
    this.options             = options
    this.$body               = $(document.body)
    this.$element            = $(element)
    this.$dialog             = this.$element.find('.modal-dialog')
    this.$backdrop           = null
    this.isShown             = null
    this.originalBodyPad     = null
    this.scrollbarWidth      = 0
    this.ignoreBackdropClick = false

    if (this.options.remote) {
      this.$element
        .find('.modal-content')
        .load(this.options.remote, $.proxy(function () {
          this.$element.trigger('loaded.bs.modal')
        }, this))
    }
  }

  Modal.VERSION  = '3.3.4'

  Modal.TRANSITION_DURATION = 300
  Modal.BACKDROP_TRANSITION_DURATION = 150

  Modal.DEFAULTS = {
    backdrop: true,
    keyboard: true,
    show: true
  }

  Modal.prototype.toggle = function (_relatedTarget) {
    return this.isShown ? this.hide() : this.show(_relatedTarget)
  }

  Modal.prototype.show = function (_relatedTarget) {
    var that = this
    var e    = $.Event('show.bs.modal', { relatedTarget: _relatedTarget })

    this.$element.trigger(e)

    if (this.isShown || e.isDefaultPrevented()) return

    this.isShown = true

    this.checkScrollbar()
    this.setScrollbar()
    this.$body.addClass('modal-open')

    this.escape()
    this.resize()

    this.$element.on('click.dismiss.bs.modal', '[data-dismiss="modal"]', $.proxy(this.hide, this))

    this.$dialog.on('mousedown.dismiss.bs.modal', function () {
      that.$element.one('mouseup.dismiss.bs.modal', function (e) {
        if ($(e.target).is(that.$element)) that.ignoreBackdropClick = true
      })
    })

    this.backdrop(function () {
      var transition = $.support.transition && that.$element.hasClass('fade')

      if (!that.$element.parent().length) {
        that.$element.appendTo(that.$body) // don't move modals dom position
      }

      that.$element
        .show()
        .scrollTop(0)

      that.adjustDialog()

      if (transition) {
        that.$element[0].offsetWidth // force reflow
      }

      that.$element
        .addClass('in')
        .attr('aria-hidden', false)

      that.enforceFocus()

      var e = $.Event('shown.bs.modal', { relatedTarget: _relatedTarget })

      transition ?
        that.$dialog // wait for modal to slide in
          .one('bsTransitionEnd', function () {
            that.$element.trigger('focus').trigger(e)
          })
          .emulateTransitionEnd(Modal.TRANSITION_DURATION) :
        that.$element.trigger('focus').trigger(e)
    })
  }

  Modal.prototype.hide = function (e) {
    if (e) e.preventDefault()

    e = $.Event('hide.bs.modal')

    this.$element.trigger(e)

    if (!this.isShown || e.isDefaultPrevented()) return

    this.isShown = false

    this.escape()
    this.resize()

    $(document).off('focusin.bs.modal')

    this.$element
      .removeClass('in')
      .attr('aria-hidden', true)
      .off('click.dismiss.bs.modal')
      .off('mouseup.dismiss.bs.modal')

    this.$dialog.off('mousedown.dismiss.bs.modal')

    $.support.transition && this.$element.hasClass('fade') ?
      this.$element
        .one('bsTransitionEnd', $.proxy(this.hideModal, this))
        .emulateTransitionEnd(Modal.TRANSITION_DURATION) :
      this.hideModal()
  }

  Modal.prototype.enforceFocus = function () {
    $(document)
      .off('focusin.bs.modal') // guard against infinite focus loop
      .on('focusin.bs.modal', $.proxy(function (e) {
        if (this.$element[0] !== e.target && !this.$element.has(e.target).length) {
          this.$element.trigger('focus')
        }
      }, this))
  }

  Modal.prototype.escape = function () {
    if (this.isShown && this.options.keyboard) {
      this.$element.on('keydown.dismiss.bs.modal', $.proxy(function (e) {
        e.which == 27 && this.hide()
      }, this))
    } else if (!this.isShown) {
      this.$element.off('keydown.dismiss.bs.modal')
    }
  }

  Modal.prototype.resize = function () {
    if (this.isShown) {
      $(window).on('resize.bs.modal', $.proxy(this.handleUpdate, this))
    } else {
      $(window).off('resize.bs.modal')
    }
  }

  Modal.prototype.hideModal = function () {
    var that = this
    this.$element.hide()
    this.backdrop(function () {
      that.$body.removeClass('modal-open')
      that.resetAdjustments()
      that.resetScrollbar()
      that.$element.trigger('hidden.bs.modal')
    })
  }

  Modal.prototype.removeBackdrop = function () {
    this.$backdrop && this.$backdrop.remove()
    this.$backdrop = null
  }

  Modal.prototype.backdrop = function (callback) {
    var that = this
    var animate = this.$element.hasClass('fade') ? 'fade' : ''

    if (this.isShown && this.options.backdrop) {
      var doAnimate = $.support.transition && animate

      this.$backdrop = $('<div class="modal-backdrop ' + animate + '" />')
        .appendTo(this.$body)

      this.$element.on('click.dismiss.bs.modal', $.proxy(function (e) {
        if (this.ignoreBackdropClick) {
          this.ignoreBackdropClick = false
          return
        }
        if (e.target !== e.currentTarget) return
        this.options.backdrop == 'static'
          ? this.$element[0].focus()
          : this.hide()
      }, this))

      if (doAnimate) this.$backdrop[0].offsetWidth // force reflow

      this.$backdrop.addClass('in')

      if (!callback) return

      doAnimate ?
        this.$backdrop
          .one('bsTransitionEnd', callback)
          .emulateTransitionEnd(Modal.BACKDROP_TRANSITION_DURATION) :
        callback()

    } else if (!this.isShown && this.$backdrop) {
      this.$backdrop.removeClass('in')

      var callbackRemove = function () {
        that.removeBackdrop()
        callback && callback()
      }
      $.support.transition && this.$element.hasClass('fade') ?
        this.$backdrop
          .one('bsTransitionEnd', callbackRemove)
          .emulateTransitionEnd(Modal.BACKDROP_TRANSITION_DURATION) :
        callbackRemove()

    } else if (callback) {
      callback()
    }
  }

  // these following methods are used to handle overflowing modals

  Modal.prototype.handleUpdate = function () {
    this.adjustDialog()
  }

  Modal.prototype.adjustDialog = function () {
    var modalIsOverflowing = this.$element[0].scrollHeight > document.documentElement.clientHeight

    this.$element.css({
      paddingLeft:  !this.bodyIsOverflowing && modalIsOverflowing ? this.scrollbarWidth : '',
      paddingRight: this.bodyIsOverflowing && !modalIsOverflowing ? this.scrollbarWidth : ''
    })
  }

  Modal.prototype.resetAdjustments = function () {
    this.$element.css({
      paddingLeft: '',
      paddingRight: ''
    })
  }

  Modal.prototype.checkScrollbar = function () {
    var fullWindowWidth = window.innerWidth
    if (!fullWindowWidth) { // workaround for missing window.innerWidth in IE8
      var documentElementRect = document.documentElement.getBoundingClientRect()
      fullWindowWidth = documentElementRect.right - Math.abs(documentElementRect.left)
    }
    this.bodyIsOverflowing = document.body.clientWidth < fullWindowWidth
    this.scrollbarWidth = this.measureScrollbar()
  }

  Modal.prototype.setScrollbar = function () {
    var bodyPad = parseInt((this.$body.css('padding-right') || 0), 10)
    this.originalBodyPad = document.body.style.paddingRight || ''
    if (this.bodyIsOverflowing) this.$body.css('padding-right', bodyPad + this.scrollbarWidth)
  }

  Modal.prototype.resetScrollbar = function () {
    this.$body.css('padding-right', this.originalBodyPad)
  }

  Modal.prototype.measureScrollbar = function () { // thx walsh
    var scrollDiv = document.createElement('div')
    scrollDiv.className = 'modal-scrollbar-measure'
    this.$body.append(scrollDiv)
    var scrollbarWidth = scrollDiv.offsetWidth - scrollDiv.clientWidth
    this.$body[0].removeChild(scrollDiv)
    return scrollbarWidth
  }


  // MODAL PLUGIN DEFINITION
  // =======================

  function Plugin(option, _relatedTarget) {
    return this.each(function () {
      var $this   = $(this)
      var data    = $this.data('bs.modal')
      var options = $.extend({}, Modal.DEFAULTS, $this.data(), typeof option == 'object' && option)

      if (!data) $this.data('bs.modal', (data = new Modal(this, options)))
      if (typeof option == 'string') data[option](_relatedTarget)
      else if (options.show) data.show(_relatedTarget)
    })
  }

  var old = $.fn.modal

  $.fn.modal             = Plugin
  $.fn.modal.Constructor = Modal


  // MODAL NO CONFLICT
  // =================

  $.fn.modal.noConflict = function () {
    $.fn.modal = old
    return this
  }


  // MODAL DATA-API
  // ==============

  $(document).on('click.bs.modal.data-api', '[data-toggle="modal"]', function (e) {
    var $this   = $(this)
    var href    = $this.attr('href')
    var $target = $($this.attr('data-target') || (href && href.replace(/.*(?=#[^\s]+$)/, ''))) // strip for ie7
    var option  = $target.data('bs.modal') ? 'toggle' : $.extend({ remote: !/#/.test(href) && href }, $target.data(), $this.data())

    if ($this.is('a')) e.preventDefault()

    $target.one('show.bs.modal', function (showEvent) {
      if (showEvent.isDefaultPrevented()) return // only register focus restorer if modal will actually get shown
      $target.one('hidden.bs.modal', function () {
        $this.is(':visible') && $this.trigger('focus')
      })
    })
    Plugin.call($target, option, this)
  })

}(jQuery);

/* ========================================================================
 * Bootstrap: tooltip.js v3.3.4
 * http://getbootstrap.com/javascript/#tooltip
 * Inspired by the original jQuery.tipsy by Jason Frame
 * ========================================================================
 * Copyright 2011-2015 Twitter, Inc.
 * Licensed under MIT (https://github.com/twbs/bootstrap/blob/master/LICENSE)
 * ======================================================================== */


+function ($) {
  'use strict';

  // TOOLTIP PUBLIC CLASS DEFINITION
  // ===============================

  var Tooltip = function (element, options) {
    this.type       = null
    this.options    = null
    this.enabled    = null
    this.timeout    = null
    this.hoverState = null
    this.$element   = null

    this.init('tooltip', element, options)
  }

  Tooltip.VERSION  = '3.3.4'

  Tooltip.TRANSITION_DURATION = 150

  Tooltip.DEFAULTS = {
    animation: true,
    placement: 'top',
    selector: false,
    template: '<div class="tooltip" role="tooltip"><div class="tooltip-arrow"></div><div class="tooltip-inner"></div></div>',
    trigger: 'hover focus',
    title: '',
    delay: 0,
    html: false,
    container: false,
    viewport: {
      selector: 'body',
      padding: 0
    }
  }

  Tooltip.prototype.init = function (type, element, options) {
    this.enabled   = true
    this.type      = type
    this.$element  = $(element)
    this.options   = this.getOptions(options)
    this.$viewport = this.options.viewport && $(this.options.viewport.selector || this.options.viewport)

    if (this.$element[0] instanceof document.constructor && !this.options.selector) {
      throw new Error('`selector` option must be specified when initializing ' + this.type + ' on the window.document object!')
    }

    var triggers = this.options.trigger.split(' ')

    for (var i = triggers.length; i--;) {
      var trigger = triggers[i]

      if (trigger == 'click') {
        this.$element.on('click.' + this.type, this.options.selector, $.proxy(this.toggle, this))
      } else if (trigger != 'manual') {
        var eventIn  = trigger == 'hover' ? 'mouseenter' : 'focusin'
        var eventOut = trigger == 'hover' ? 'mouseleave' : 'focusout'

        this.$element.on(eventIn  + '.' + this.type, this.options.selector, $.proxy(this.enter, this))
        this.$element.on(eventOut + '.' + this.type, this.options.selector, $.proxy(this.leave, this))
      }
    }

    this.options.selector ?
      (this._options = $.extend({}, this.options, { trigger: 'manual', selector: '' })) :
      this.fixTitle()
  }

  Tooltip.prototype.getDefaults = function () {
    return Tooltip.DEFAULTS
  }

  Tooltip.prototype.getOptions = function (options) {
    options = $.extend({}, this.getDefaults(), this.$element.data(), options)

    if (options.delay && typeof options.delay == 'number') {
      options.delay = {
        show: options.delay,
        hide: options.delay
      }
    }

    return options
  }

  Tooltip.prototype.getDelegateOptions = function () {
    var options  = {}
    var defaults = this.getDefaults()

    this._options && $.each(this._options, function (key, value) {
      if (defaults[key] != value) options[key] = value
    })

    return options
  }

  Tooltip.prototype.enter = function (obj) {
    var self = obj instanceof this.constructor ?
      obj : $(obj.currentTarget).data('bs.' + this.type)

    if (self && self.$tip && self.$tip.is(':visible')) {
      self.hoverState = 'in'
      return
    }

    if (!self) {
      self = new this.constructor(obj.currentTarget, this.getDelegateOptions())
      $(obj.currentTarget).data('bs.' + this.type, self)
    }

    clearTimeout(self.timeout)

    self.hoverState = 'in'

    if (!self.options.delay || !self.options.delay.show) return self.show()

    self.timeout = setTimeout(function () {
      if (self.hoverState == 'in') self.show()
    }, self.options.delay.show)
  }

  Tooltip.prototype.leave = function (obj) {
    var self = obj instanceof this.constructor ?
      obj : $(obj.currentTarget).data('bs.' + this.type)

    if (!self) {
      self = new this.constructor(obj.currentTarget, this.getDelegateOptions())
      $(obj.currentTarget).data('bs.' + this.type, self)
    }

    clearTimeout(self.timeout)

    self.hoverState = 'out'

    if (!self.options.delay || !self.options.delay.hide) return self.hide()

    self.timeout = setTimeout(function () {
      if (self.hoverState == 'out') self.hide()
    }, self.options.delay.hide)
  }

  Tooltip.prototype.show = function () {
    var e = $.Event('show.bs.' + this.type)

    if (this.hasContent() && this.enabled) {
      this.$element.trigger(e)

      var inDom = $.contains(this.$element[0].ownerDocument.documentElement, this.$element[0])
      if (e.isDefaultPrevented() || !inDom) return
      var that = this

      var $tip = this.tip()

      var tipId = this.getUID(this.type)

      this.setContent()
      $tip.attr('id', tipId)
      this.$element.attr('aria-describedby', tipId)

      if (this.options.animation) $tip.addClass('fade')

      var placement = typeof this.options.placement == 'function' ?
        this.options.placement.call(this, $tip[0], this.$element[0]) :
        this.options.placement

      var autoToken = /\s?auto?\s?/i
      var autoPlace = autoToken.test(placement)
      if (autoPlace) placement = placement.replace(autoToken, '') || 'top'

      $tip
        .detach()
        .css({ top: 0, left: 0, display: 'block' })
        .addClass(placement)
        .data('bs.' + this.type, this)

      this.options.container ? $tip.appendTo(this.options.container) : $tip.insertAfter(this.$element)

      var pos          = this.getPosition()
      var actualWidth  = $tip[0].offsetWidth
      var actualHeight = $tip[0].offsetHeight

      if (autoPlace) {
        var orgPlacement = placement
        var $container   = this.options.container ? $(this.options.container) : this.$element.parent()
        var containerDim = this.getPosition($container)

        placement = placement == 'bottom' && pos.bottom + actualHeight > containerDim.bottom ? 'top'    :
                    placement == 'top'    && pos.top    - actualHeight < containerDim.top    ? 'bottom' :
                    placement == 'right'  && pos.right  + actualWidth  > containerDim.width  ? 'left'   :
                    placement == 'left'   && pos.left   - actualWidth  < containerDim.left   ? 'right'  :
                    placement

        $tip
          .removeClass(orgPlacement)
          .addClass(placement)
      }

      var calculatedOffset = this.getCalculatedOffset(placement, pos, actualWidth, actualHeight)

      this.applyPlacement(calculatedOffset, placement)

      var complete = function () {
        var prevHoverState = that.hoverState
        that.$element.trigger('shown.bs.' + that.type)
        that.hoverState = null

        if (prevHoverState == 'out') that.leave(that)
      }

      $.support.transition && this.$tip.hasClass('fade') ?
        $tip
          .one('bsTransitionEnd', complete)
          .emulateTransitionEnd(Tooltip.TRANSITION_DURATION) :
        complete()
    }
  }

  Tooltip.prototype.applyPlacement = function (offset, placement) {
    var $tip   = this.tip()
    var width  = $tip[0].offsetWidth
    var height = $tip[0].offsetHeight

    // manually read margins because getBoundingClientRect includes difference
    var marginTop = parseInt($tip.css('margin-top'), 10)
    var marginLeft = parseInt($tip.css('margin-left'), 10)

    // we must check for NaN for ie 8/9
    if (isNaN(marginTop))  marginTop  = 0
    if (isNaN(marginLeft)) marginLeft = 0

    offset.top  = offset.top  + marginTop
    offset.left = offset.left + marginLeft

    // $.fn.offset doesn't round pixel values
    // so we use setOffset directly with our own function B-0
    $.offset.setOffset($tip[0], $.extend({
      using: function (props) {
        $tip.css({
          top: Math.round(props.top),
          left: Math.round(props.left)
        })
      }
    }, offset), 0)

    $tip.addClass('in')

    // check to see if placing tip in new offset caused the tip to resize itself
    var actualWidth  = $tip[0].offsetWidth
    var actualHeight = $tip[0].offsetHeight

    if (placement == 'top' && actualHeight != height) {
      offset.top = offset.top + height - actualHeight
    }

    var delta = this.getViewportAdjustedDelta(placement, offset, actualWidth, actualHeight)

    if (delta.left) offset.left += delta.left
    else offset.top += delta.top

    var isVertical          = /top|bottom/.test(placement)
    var arrowDelta          = isVertical ? delta.left * 2 - width + actualWidth : delta.top * 2 - height + actualHeight
    var arrowOffsetPosition = isVertical ? 'offsetWidth' : 'offsetHeight'

    $tip.offset(offset)
    this.replaceArrow(arrowDelta, $tip[0][arrowOffsetPosition], isVertical)
  }

  Tooltip.prototype.replaceArrow = function (delta, dimension, isVertical) {
    this.arrow()
      .css(isVertical ? 'left' : 'top', 50 * (1 - delta / dimension) + '%')
      .css(isVertical ? 'top' : 'left', '')
  }

  Tooltip.prototype.setContent = function () {
    var $tip  = this.tip()
    var title = this.getTitle()

    $tip.find('.tooltip-inner')[this.options.html ? 'html' : 'text'](title)
    $tip.removeClass('fade in top bottom left right')
  }

  Tooltip.prototype.hide = function (callback) {
    var that = this
    var $tip = $(this.$tip)
    var e    = $.Event('hide.bs.' + this.type)

    function complete() {
      if (that.hoverState != 'in') $tip.detach()
      that.$element
        .removeAttr('aria-describedby')
        .trigger('hidden.bs.' + that.type)
      callback && callback()
    }

    this.$element.trigger(e)

    if (e.isDefaultPrevented()) return

    $tip.removeClass('in')

    $.support.transition && $tip.hasClass('fade') ?
      $tip
        .one('bsTransitionEnd', complete)
        .emulateTransitionEnd(Tooltip.TRANSITION_DURATION) :
      complete()

    this.hoverState = null

    return this
  }

  Tooltip.prototype.fixTitle = function () {
    var $e = this.$element
    if ($e.attr('title') || typeof ($e.attr('data-original-title')) != 'string') {
      $e.attr('data-original-title', $e.attr('title') || '').attr('title', '')
    }
  }

  Tooltip.prototype.hasContent = function () {
    return this.getTitle()
  }

  Tooltip.prototype.getPosition = function ($element) {
    $element   = $element || this.$element

    var el     = $element[0]
    var isBody = el.tagName == 'BODY'

    var elRect    = el.getBoundingClientRect()
    if (elRect.width == null) {
      // width and height are missing in IE8, so compute them manually; see https://github.com/twbs/bootstrap/issues/14093
      elRect = $.extend({}, elRect, { width: elRect.right - elRect.left, height: elRect.bottom - elRect.top })
    }
    var elOffset  = isBody ? { top: 0, left: 0 } : $element.offset()
    var scroll    = { scroll: isBody ? document.documentElement.scrollTop || document.body.scrollTop : $element.scrollTop() }
    var outerDims = isBody ? { width: $(window).width(), height: $(window).height() } : null

    return $.extend({}, elRect, scroll, outerDims, elOffset)
  }

  Tooltip.prototype.getCalculatedOffset = function (placement, pos, actualWidth, actualHeight) {
    return placement == 'bottom' ? { top: pos.top + pos.height,   left: pos.left + pos.width / 2 - actualWidth / 2 } :
           placement == 'top'    ? { top: pos.top - actualHeight, left: pos.left + pos.width / 2 - actualWidth / 2 } :
           placement == 'left'   ? { top: pos.top + pos.height / 2 - actualHeight / 2, left: pos.left - actualWidth } :
        /* placement == 'right' */ { top: pos.top + pos.height / 2 - actualHeight / 2, left: pos.left + pos.width }

  }

  Tooltip.prototype.getViewportAdjustedDelta = function (placement, pos, actualWidth, actualHeight) {
    var delta = { top: 0, left: 0 }
    if (!this.$viewport) return delta

    var viewportPadding = this.options.viewport && this.options.viewport.padding || 0
    var viewportDimensions = this.getPosition(this.$viewport)

    if (/right|left/.test(placement)) {
      var topEdgeOffset    = pos.top - viewportPadding - viewportDimensions.scroll
      var bottomEdgeOffset = pos.top + viewportPadding - viewportDimensions.scroll + actualHeight
      if (topEdgeOffset < viewportDimensions.top) { // top overflow
        delta.top = viewportDimensions.top - topEdgeOffset
      } else if (bottomEdgeOffset > viewportDimensions.top + viewportDimensions.height) { // bottom overflow
        delta.top = viewportDimensions.top + viewportDimensions.height - bottomEdgeOffset
      }
    } else {
      var leftEdgeOffset  = pos.left - viewportPadding
      var rightEdgeOffset = pos.left + viewportPadding + actualWidth
      if (leftEdgeOffset < viewportDimensions.left) { // left overflow
        delta.left = viewportDimensions.left - leftEdgeOffset
      } else if (rightEdgeOffset > viewportDimensions.width) { // right overflow
        delta.left = viewportDimensions.left + viewportDimensions.width - rightEdgeOffset
      }
    }

    return delta
  }

  Tooltip.prototype.getTitle = function () {
    var title
    var $e = this.$element
    var o  = this.options

    title = $e.attr('data-original-title')
      || (typeof o.title == 'function' ? o.title.call($e[0]) :  o.title)

    return title
  }

  Tooltip.prototype.getUID = function (prefix) {
    do prefix += ~~(Math.random() * 1000000)
    while (document.getElementById(prefix))
    return prefix
  }

  Tooltip.prototype.tip = function () {
    return (this.$tip = this.$tip || $(this.options.template))
  }

  Tooltip.prototype.arrow = function () {
    return (this.$arrow = this.$arrow || this.tip().find('.tooltip-arrow'))
  }

  Tooltip.prototype.enable = function () {
    this.enabled = true
  }

  Tooltip.prototype.disable = function () {
    this.enabled = false
  }

  Tooltip.prototype.toggleEnabled = function () {
    this.enabled = !this.enabled
  }

  Tooltip.prototype.toggle = function (e) {
    var self = this
    if (e) {
      self = $(e.currentTarget).data('bs.' + this.type)
      if (!self) {
        self = new this.constructor(e.currentTarget, this.getDelegateOptions())
        $(e.currentTarget).data('bs.' + this.type, self)
      }
    }

    self.tip().hasClass('in') ? self.leave(self) : self.enter(self)
  }

  Tooltip.prototype.destroy = function () {
    var that = this
    clearTimeout(this.timeout)
    this.hide(function () {
      that.$element.off('.' + that.type).removeData('bs.' + that.type)
    })
  }


  // TOOLTIP PLUGIN DEFINITION
  // =========================

  function Plugin(option) {
    return this.each(function () {
      var $this   = $(this)
      var data    = $this.data('bs.tooltip')
      var options = typeof option == 'object' && option

      if (!data && /destroy|hide/.test(option)) return
      if (!data) $this.data('bs.tooltip', (data = new Tooltip(this, options)))
      if (typeof option == 'string') data[option]()
    })
  }

  var old = $.fn.tooltip

  $.fn.tooltip             = Plugin
  $.fn.tooltip.Constructor = Tooltip


  // TOOLTIP NO CONFLICT
  // ===================

  $.fn.tooltip.noConflict = function () {
    $.fn.tooltip = old
    return this
  }

}(jQuery);

/* ========================================================================
 * Bootstrap: popover.js v3.3.4
 * http://getbootstrap.com/javascript/#popovers
 * ========================================================================
 * Copyright 2011-2015 Twitter, Inc.
 * Licensed under MIT (https://github.com/twbs/bootstrap/blob/master/LICENSE)
 * ======================================================================== */


+function ($) {
  'use strict';

  // POPOVER PUBLIC CLASS DEFINITION
  // ===============================

  var Popover = function (element, options) {
    this.init('popover', element, options)
  }

  if (!$.fn.tooltip) throw new Error('Popover requires tooltip.js')

  Popover.VERSION  = '3.3.4'

  Popover.DEFAULTS = $.extend({}, $.fn.tooltip.Constructor.DEFAULTS, {
    placement: 'right',
    trigger: 'click',
    content: '',
    template: '<div class="popover" role="tooltip"><div class="arrow"></div><h3 class="popover-title"></h3><div class="popover-content"></div></div>'
  })


  // NOTE: POPOVER EXTENDS tooltip.js
  // ================================

  Popover.prototype = $.extend({}, $.fn.tooltip.Constructor.prototype)

  Popover.prototype.constructor = Popover

  Popover.prototype.getDefaults = function () {
    return Popover.DEFAULTS
  }

  Popover.prototype.setContent = function () {
    var $tip    = this.tip()
    var title   = this.getTitle()
    var content = this.getContent()

    $tip.find('.popover-title')[this.options.html ? 'html' : 'text'](title)
    $tip.find('.popover-content').children().detach().end()[ // we use append for html objects to maintain js events
      this.options.html ? (typeof content == 'string' ? 'html' : 'append') : 'text'
    ](content)

    $tip.removeClass('fade top bottom left right in')

    // IE8 doesn't accept hiding via the `:empty` pseudo selector, we have to do
    // this manually by checking the contents.
    if (!$tip.find('.popover-title').html()) $tip.find('.popover-title').hide()
  }

  Popover.prototype.hasContent = function () {
    return this.getTitle() || this.getContent()
  }

  Popover.prototype.getContent = function () {
    var $e = this.$element
    var o  = this.options

    return $e.attr('data-content')
      || (typeof o.content == 'function' ?
            o.content.call($e[0]) :
            o.content)
  }

  Popover.prototype.arrow = function () {
    return (this.$arrow = this.$arrow || this.tip().find('.arrow'))
  }


  // POPOVER PLUGIN DEFINITION
  // =========================

  function Plugin(option) {
    return this.each(function () {
      var $this   = $(this)
      var data    = $this.data('bs.popover')
      var options = typeof option == 'object' && option

      if (!data && /destroy|hide/.test(option)) return
      if (!data) $this.data('bs.popover', (data = new Popover(this, options)))
      if (typeof option == 'string') data[option]()
    })
  }

  var old = $.fn.popover

  $.fn.popover             = Plugin
  $.fn.popover.Constructor = Popover


  // POPOVER NO CONFLICT
  // ===================

  $.fn.popover.noConflict = function () {
    $.fn.popover = old
    return this
  }

}(jQuery);

/* ========================================================================
 * Bootstrap: scrollspy.js v3.3.4
 * http://getbootstrap.com/javascript/#scrollspy
 * ========================================================================
 * Copyright 2011-2015 Twitter, Inc.
 * Licensed under MIT (https://github.com/twbs/bootstrap/blob/master/LICENSE)
 * ======================================================================== */


+function ($) {
  'use strict';

  // SCROLLSPY CLASS DEFINITION
  // ==========================

  function ScrollSpy(element, options) {
    this.$body          = $(document.body)
    this.$scrollElement = $(element).is(document.body) ? $(window) : $(element)
    this.options        = $.extend({}, ScrollSpy.DEFAULTS, options)
    this.selector       = (this.options.target || '') + ' .nav li > a'
    this.offsets        = []
    this.targets        = []
    this.activeTarget   = null
    this.scrollHeight   = 0

    this.$scrollElement.on('scroll.bs.scrollspy', $.proxy(this.process, this))
    this.refresh()
    this.process()
  }

  ScrollSpy.VERSION  = '3.3.4'

  ScrollSpy.DEFAULTS = {
    offset: 10
  }

  ScrollSpy.prototype.getScrollHeight = function () {
    return this.$scrollElement[0].scrollHeight || Math.max(this.$body[0].scrollHeight, document.documentElement.scrollHeight)
  }

  ScrollSpy.prototype.refresh = function () {
    var that          = this
    var offsetMethod  = 'offset'
    var offsetBase    = 0

    this.offsets      = []
    this.targets      = []
    this.scrollHeight = this.getScrollHeight()

    if (!$.isWindow(this.$scrollElement[0])) {
      offsetMethod = 'position'
      offsetBase   = this.$scrollElement.scrollTop()
    }

    this.$body
      .find(this.selector)
      .map(function () {
        var $el   = $(this)
        var href  = $el.data('target') || $el.attr('href')
        var $href = /^#./.test(href) && $(href)

        return ($href
          && $href.length
          && $href.is(':visible')
          && [[$href[offsetMethod]().top + offsetBase, href]]) || null
      })
      .sort(function (a, b) { return a[0] - b[0] })
      .each(function () {
        that.offsets.push(this[0])
        that.targets.push(this[1])
      })
  }

  ScrollSpy.prototype.process = function () {
    var scrollTop    = this.$scrollElement.scrollTop() + this.options.offset
    var scrollHeight = this.getScrollHeight()
    var maxScroll    = this.options.offset + scrollHeight - this.$scrollElement.height()
    var offsets      = this.offsets
    var targets      = this.targets
    var activeTarget = this.activeTarget
    var i

    if (this.scrollHeight != scrollHeight) {
      this.refresh()
    }

    if (scrollTop >= maxScroll) {
      return activeTarget != (i = targets[targets.length - 1]) && this.activate(i)
    }

    if (activeTarget && scrollTop < offsets[0]) {
      this.activeTarget = null
      return this.clear()
    }

    for (i = offsets.length; i--;) {
      activeTarget != targets[i]
        && scrollTop >= offsets[i]
        && (offsets[i + 1] === undefined || scrollTop < offsets[i + 1])
        && this.activate(targets[i])
    }
  }

  ScrollSpy.prototype.activate = function (target) {
    this.activeTarget = target

    this.clear()

    var selector = this.selector +
      '[data-target="' + target + '"],' +
      this.selector + '[href="' + target + '"]'

    var active = $(selector)
      .parents('li')
      .addClass('active')

    if (active.parent('.dropdown-menu').length) {
      active = active
        .closest('li.dropdown')
        .addClass('active')
    }

    active.trigger('activate.bs.scrollspy')
  }

  ScrollSpy.prototype.clear = function () {
    $(this.selector)
      .parentsUntil(this.options.target, '.active')
      .removeClass('active')
  }


  // SCROLLSPY PLUGIN DEFINITION
  // ===========================

  function Plugin(option) {
    return this.each(function () {
      var $this   = $(this)
      var data    = $this.data('bs.scrollspy')
      var options = typeof option == 'object' && option

      if (!data) $this.data('bs.scrollspy', (data = new ScrollSpy(this, options)))
      if (typeof option == 'string') data[option]()
    })
  }

  var old = $.fn.scrollspy

  $.fn.scrollspy             = Plugin
  $.fn.scrollspy.Constructor = ScrollSpy


  // SCROLLSPY NO CONFLICT
  // =====================

  $.fn.scrollspy.noConflict = function () {
    $.fn.scrollspy = old
    return this
  }


  // SCROLLSPY DATA-API
  // ==================

  $(window).on('load.bs.scrollspy.data-api', function () {
    $('[data-spy="scroll"]').each(function () {
      var $spy = $(this)
      Plugin.call($spy, $spy.data())
    })
  })

}(jQuery);

/* ========================================================================
 * Bootstrap: tab.js v3.3.4
 * http://getbootstrap.com/javascript/#tabs
 * ========================================================================
 * Copyright 2011-2015 Twitter, Inc.
 * Licensed under MIT (https://github.com/twbs/bootstrap/blob/master/LICENSE)
 * ======================================================================== */


+function ($) {
  'use strict';

  // TAB CLASS DEFINITION
  // ====================

  var Tab = function (element) {
    this.element = $(element)
  }

  Tab.VERSION = '3.3.4'

  Tab.TRANSITION_DURATION = 150

  Tab.prototype.show = function () {
    var $this    = this.element
    var $ul      = $this.closest('ul:not(.dropdown-menu)')
    var selector = $this.data('target')

    if (!selector) {
      selector = $this.attr('href')
      selector = selector && selector.replace(/.*(?=#[^\s]*$)/, '') // strip for ie7
    }

    if ($this.parent('li').hasClass('active')) return

    var $previous = $ul.find('.active:last a')
    var hideEvent = $.Event('hide.bs.tab', {
      relatedTarget: $this[0]
    })
    var showEvent = $.Event('show.bs.tab', {
      relatedTarget: $previous[0]
    })

    $previous.trigger(hideEvent)
    $this.trigger(showEvent)

    if (showEvent.isDefaultPrevented() || hideEvent.isDefaultPrevented()) return

    var $target = $(selector)

    this.activate($this.closest('li'), $ul)
    this.activate($target, $target.parent(), function () {
      $previous.trigger({
        type: 'hidden.bs.tab',
        relatedTarget: $this[0]
      })
      $this.trigger({
        type: 'shown.bs.tab',
        relatedTarget: $previous[0]
      })
    })
  }

  Tab.prototype.activate = function (element, container, callback) {
    var $active    = container.find('> .active')
    var transition = callback
      && $.support.transition
      && (($active.length && $active.hasClass('fade')) || !!container.find('> .fade').length)

    function next() {
      $active
        .removeClass('active')
        .find('> .dropdown-menu > .active')
          .removeClass('active')
        .end()
        .find('[data-toggle="tab"]')
          .attr('aria-expanded', false)

      element
        .addClass('active')
        .find('[data-toggle="tab"]')
          .attr('aria-expanded', true)

      if (transition) {
        element[0].offsetWidth // reflow for transition
        element.addClass('in')
      } else {
        element.removeClass('fade')
      }

      if (element.parent('.dropdown-menu').length) {
        element
          .closest('li.dropdown')
            .addClass('active')
          .end()
          .find('[data-toggle="tab"]')
            .attr('aria-expanded', true)
      }

      callback && callback()
    }

    $active.length && transition ?
      $active
        .one('bsTransitionEnd', next)
        .emulateTransitionEnd(Tab.TRANSITION_DURATION) :
      next()

    $active.removeClass('in')
  }


  // TAB PLUGIN DEFINITION
  // =====================

  function Plugin(option) {
    return this.each(function () {
      var $this = $(this)
      var data  = $this.data('bs.tab')

      if (!data) $this.data('bs.tab', (data = new Tab(this)))
      if (typeof option == 'string') data[option]()
    })
  }

  var old = $.fn.tab

  $.fn.tab             = Plugin
  $.fn.tab.Constructor = Tab


  // TAB NO CONFLICT
  // ===============

  $.fn.tab.noConflict = function () {
    $.fn.tab = old
    return this
  }


  // TAB DATA-API
  // ============

  var clickHandler = function (e) {
    e.preventDefault()
    Plugin.call($(this), 'show')
  }

  $(document)
    .on('click.bs.tab.data-api', '[data-toggle="tab"]', clickHandler)
    .on('click.bs.tab.data-api', '[data-toggle="pill"]', clickHandler)

}(jQuery);

/* ========================================================================
 * Bootstrap: affix.js v3.3.4
 * http://getbootstrap.com/javascript/#affix
 * ========================================================================
 * Copyright 2011-2015 Twitter, Inc.
 * Licensed under MIT (https://github.com/twbs/bootstrap/blob/master/LICENSE)
 * ======================================================================== */


+function ($) {
  'use strict';

  // AFFIX CLASS DEFINITION
  // ======================

  var Affix = function (element, options) {
    this.options = $.extend({}, Affix.DEFAULTS, options)

    this.$target = $(this.options.target)
      .on('scroll.bs.affix.data-api', $.proxy(this.checkPosition, this))
      .on('click.bs.affix.data-api',  $.proxy(this.checkPositionWithEventLoop, this))

    this.$element     = $(element)
    this.affixed      = null
    this.unpin        = null
    this.pinnedOffset = null

    this.checkPosition()
  }

  Affix.VERSION  = '3.3.4'

  Affix.RESET    = 'affix affix-top affix-bottom'

  Affix.DEFAULTS = {
    offset: 0,
    target: window
  }

  Affix.prototype.getState = function (scrollHeight, height, offsetTop, offsetBottom) {
    var scrollTop    = this.$target.scrollTop()
    var position     = this.$element.offset()
    var targetHeight = this.$target.height()

    if (offsetTop != null && this.affixed == 'top') return scrollTop < offsetTop ? 'top' : false

    if (this.affixed == 'bottom') {
      if (offsetTop != null) return (scrollTop + this.unpin <= position.top) ? false : 'bottom'
      return (scrollTop + targetHeight <= scrollHeight - offsetBottom) ? false : 'bottom'
    }

    var initializing   = this.affixed == null
    var colliderTop    = initializing ? scrollTop : position.top
    var colliderHeight = initializing ? targetHeight : height

    if (offsetTop != null && scrollTop <= offsetTop) return 'top'
    if (offsetBottom != null && (colliderTop + colliderHeight >= scrollHeight - offsetBottom)) return 'bottom'

    return false
  }

  Affix.prototype.getPinnedOffset = function () {
    if (this.pinnedOffset) return this.pinnedOffset
    this.$element.removeClass(Affix.RESET).addClass('affix')
    var scrollTop = this.$target.scrollTop()
    var position  = this.$element.offset()
    return (this.pinnedOffset = position.top - scrollTop)
  }

  Affix.prototype.checkPositionWithEventLoop = function () {
    setTimeout($.proxy(this.checkPosition, this), 1)
  }

  Affix.prototype.checkPosition = function () {
    if (!this.$element.is(':visible')) return

    var height       = this.$element.height()
    var offset       = this.options.offset
    var offsetTop    = offset.top
    var offsetBottom = offset.bottom
    var scrollHeight = $(document.body).height()

    if (typeof offset != 'object')         offsetBottom = offsetTop = offset
    if (typeof offsetTop == 'function')    offsetTop    = offset.top(this.$element)
    if (typeof offsetBottom == 'function') offsetBottom = offset.bottom(this.$element)

    var affix = this.getState(scrollHeight, height, offsetTop, offsetBottom)

    if (this.affixed != affix) {
      if (this.unpin != null) this.$element.css('top', '')

      var affixType = 'affix' + (affix ? '-' + affix : '')
      var e         = $.Event(affixType + '.bs.affix')

      this.$element.trigger(e)

      if (e.isDefaultPrevented()) return

      this.affixed = affix
      this.unpin = affix == 'bottom' ? this.getPinnedOffset() : null

      this.$element
        .removeClass(Affix.RESET)
        .addClass(affixType)
        .trigger(affixType.replace('affix', 'affixed') + '.bs.affix')
    }

    if (affix == 'bottom') {
      this.$element.offset({
        top: scrollHeight - height - offsetBottom
      })
    }
  }


  // AFFIX PLUGIN DEFINITION
  // =======================

  function Plugin(option) {
    return this.each(function () {
      var $this   = $(this)
      var data    = $this.data('bs.affix')
      var options = typeof option == 'object' && option

      if (!data) $this.data('bs.affix', (data = new Affix(this, options)))
      if (typeof option == 'string') data[option]()
    })
  }

  var old = $.fn.affix

  $.fn.affix             = Plugin
  $.fn.affix.Constructor = Affix


  // AFFIX NO CONFLICT
  // =================

  $.fn.affix.noConflict = function () {
    $.fn.affix = old
    return this
  }


  // AFFIX DATA-API
  // ==============

  $(window).on('load', function () {
    $('[data-spy="affix"]').each(function () {
      var $spy = $(this)
      var data = $spy.data()

      data.offset = data.offset || {}

      if (data.offsetBottom != null) data.offset.bottom = data.offsetBottom
      if (data.offsetTop    != null) data.offset.top    = data.offsetTop

      Plugin.call($spy, data)
    })
  })

}(jQuery);

define("bootstrap", function(){});

/*!
 * Amplify 1.1.2
 *
 * Copyright 2011 - 2013 appendTo LLC. (http://appendto.com/team)
 * Dual licensed under the MIT or GPL licenses.
 * http://appendto.com/open-source-licenses
 *
 * http://amplifyjs.com
 */
(function( global, undefined ) {

var slice = [].slice,
	subscriptions = {};

var amplify = global.amplify = {
	publish: function( topic ) {
		if ( typeof topic !== "string" ) {
			throw new Error( "You must provide a valid topic to publish." );
		}

		var args = slice.call( arguments, 1 ),
			topicSubscriptions,
			subscription,
			length,
			i = 0,
			ret;

		if ( !subscriptions[ topic ] ) {
			return true;
		}

		topicSubscriptions = subscriptions[ topic ].slice();
		for ( length = topicSubscriptions.length; i < length; i++ ) {
			subscription = topicSubscriptions[ i ];
			ret = subscription.callback.apply( subscription.context, args );
			if ( ret === false ) {
				break;
			}
		}
		return ret !== false;
	},

	subscribe: function( topic, context, callback, priority ) {
		if ( typeof topic !== "string" ) {
			throw new Error( "You must provide a valid topic to create a subscription." );
		}

		if ( arguments.length === 3 && typeof callback === "number" ) {
			priority = callback;
			callback = context;
			context = null;
		}
		if ( arguments.length === 2 ) {
			callback = context;
			context = null;
		}
		priority = priority || 10;

		var topicIndex = 0,
			topics = topic.split( /\s/ ),
			topicLength = topics.length,
			added;
		for ( ; topicIndex < topicLength; topicIndex++ ) {
			topic = topics[ topicIndex ];
			added = false;
			if ( !subscriptions[ topic ] ) {
				subscriptions[ topic ] = [];
			}

			var i = subscriptions[ topic ].length - 1,
				subscriptionInfo = {
					callback: callback,
					context: context,
					priority: priority
				};

			for ( ; i >= 0; i-- ) {
				if ( subscriptions[ topic ][ i ].priority <= priority ) {
					subscriptions[ topic ].splice( i + 1, 0, subscriptionInfo );
					added = true;
					break;
				}
			}

			if ( !added ) {
				subscriptions[ topic ].unshift( subscriptionInfo );
			}
		}

		return callback;
	},

	unsubscribe: function( topic, context, callback ) {
		if ( typeof topic !== "string" ) {
			throw new Error( "You must provide a valid topic to remove a subscription." );
		}

		if ( arguments.length === 2 ) {
			callback = context;
			context = null;
		}

		if ( !subscriptions[ topic ] ) {
			return;
		}

		var length = subscriptions[ topic ].length,
			i = 0;

		for ( ; i < length; i++ ) {
			if ( subscriptions[ topic ][ i ].callback === callback ) {
				if ( !context || subscriptions[ topic ][ i ].context === context ) {
					subscriptions[ topic ].splice( i, 1 );
					
					// Adjust counter and length for removed item
					i--;
					length--;
				}
			}
		}
	}
};

}( this ) );

(function( amplify, undefined ) {

var store = amplify.store = function( key, value, options ) {
	var type = store.type;
	if ( options && options.type && options.type in store.types ) {
		type = options.type;
	}
	return store.types[ type ]( key, value, options || {} );
};

store.types = {};
store.type = null;
store.addType = function( type, storage ) {
	if ( !store.type ) {
		store.type = type;
	}

	store.types[ type ] = storage;
	store[ type ] = function( key, value, options ) {
		options = options || {};
		options.type = type;
		return store( key, value, options );
	};
};
store.error = function() {
	return "amplify.store quota exceeded";
};

var rprefix = /^__amplify__/;
function createFromStorageInterface( storageType, storage ) {
	store.addType( storageType, function( key, value, options ) {
		var storedValue, parsed, i, remove,
			ret = value,
			now = (new Date()).getTime();

		if ( !key ) {
			ret = {};
			remove = [];
			i = 0;
			try {
				// accessing the length property works around a localStorage bug
				// in Firefox 4.0 where the keys don't update cross-page
				// we assign to key just to avoid Closure Compiler from removing
				// the access as "useless code"
				// https://bugzilla.mozilla.org/show_bug.cgi?id=662511
				key = storage.length;

				while ( key = storage.key( i++ ) ) {
					if ( rprefix.test( key ) ) {
						parsed = JSON.parse( storage.getItem( key ) );
						if ( parsed.expires && parsed.expires <= now ) {
							remove.push( key );
						} else {
							ret[ key.replace( rprefix, "" ) ] = parsed.data;
						}
					}
				}
				while ( key = remove.pop() ) {
					storage.removeItem( key );
				}
			} catch ( error ) {}
			return ret;
		}

		// protect against name collisions with direct storage
		key = "__amplify__" + key;

		if ( value === undefined ) {
			storedValue = storage.getItem( key );
			parsed = storedValue ? JSON.parse( storedValue ) : { expires: -1 };
			if ( parsed.expires && parsed.expires <= now ) {
				storage.removeItem( key );
			} else {
				return parsed.data;
			}
		} else {
			if ( value === null ) {
				storage.removeItem( key );
			} else {
				parsed = JSON.stringify({
					data: value,
					expires: options.expires ? now + options.expires : null
				});
				try {
					storage.setItem( key, parsed );
				// quota exceeded
				} catch( error ) {
					// expire old data and try again
					store[ storageType ]();
					try {
						storage.setItem( key, parsed );
					} catch( error ) {
						throw store.error();
					}
				}
			}
		}

		return ret;
	});
}

// localStorage + sessionStorage
// IE 8+, Firefox 3.5+, Safari 4+, Chrome 4+, Opera 10.5+, iPhone 2+, Android 2+
for ( var webStorageType in { localStorage: 1, sessionStorage: 1 } ) {
	// try/catch for file protocol in Firefox and Private Browsing in Safari 5
	try {
		// Safari 5 in Private Browsing mode exposes localStorage
		// but doesn't allow storing data, so we attempt to store and remove an item.
		// This will unfortunately give us a false negative if we're at the limit.
		window[ webStorageType ].setItem( "__amplify__", "x" );
		window[ webStorageType ].removeItem( "__amplify__" );
		createFromStorageInterface( webStorageType, window[ webStorageType ] );
	} catch( e ) {}
}

// globalStorage
// non-standard: Firefox 2+
// https://developer.mozilla.org/en/dom/storage#globalStorage
if ( !store.types.localStorage && window.globalStorage ) {
	// try/catch for file protocol in Firefox
	try {
		createFromStorageInterface( "globalStorage",
			window.globalStorage[ window.location.hostname ] );
		// Firefox 2.0 and 3.0 have sessionStorage and globalStorage
		// make sure we default to globalStorage
		// but don't default to globalStorage in 3.5+ which also has localStorage
		if ( store.type === "sessionStorage" ) {
			store.type = "globalStorage";
		}
	} catch( e ) {}
}

// userData
// non-standard: IE 5+
// http://msdn.microsoft.com/en-us/library/ms531424(v=vs.85).aspx
(function() {
	// IE 9 has quirks in userData that are a huge pain
	// rather than finding a way to detect these quirks
	// we just don't register userData if we have localStorage
	if ( store.types.localStorage ) {
		return;
	}

	// append to html instead of body so we can do this from the head
	var div = document.createElement( "div" ),
		attrKey = "amplify";
	div.style.display = "none";
	document.getElementsByTagName( "head" )[ 0 ].appendChild( div );

	// we can't feature detect userData support
	// so just try and see if it fails
	// surprisingly, even just adding the behavior isn't enough for a failure
	// so we need to load the data as well
	try {
		div.addBehavior( "#default#userdata" );
		div.load( attrKey );
	} catch( e ) {
		div.parentNode.removeChild( div );
		return;
	}

	store.addType( "userData", function( key, value, options ) {
		div.load( attrKey );
		var attr, parsed, prevValue, i, remove,
			ret = value,
			now = (new Date()).getTime();

		if ( !key ) {
			ret = {};
			remove = [];
			i = 0;
			while ( attr = div.XMLDocument.documentElement.attributes[ i++ ] ) {
				parsed = JSON.parse( attr.value );
				if ( parsed.expires && parsed.expires <= now ) {
					remove.push( attr.name );
				} else {
					ret[ attr.name ] = parsed.data;
				}
			}
			while ( key = remove.pop() ) {
				div.removeAttribute( key );
			}
			div.save( attrKey );
			return ret;
		}

		// convert invalid characters to dashes
		// http://www.w3.org/TR/REC-xml/#NT-Name
		// simplified to assume the starting character is valid
		// also removed colon as it is invalid in HTML attribute names
		key = key.replace( /[^\-._0-9A-Za-z\xb7\xc0-\xd6\xd8-\xf6\xf8-\u037d\u037f-\u1fff\u200c-\u200d\u203f\u2040\u2070-\u218f]/g, "-" );
		// adjust invalid starting character to deal with our simplified sanitization
		key = key.replace( /^-/, "_-" );

		if ( value === undefined ) {
			attr = div.getAttribute( key );
			parsed = attr ? JSON.parse( attr ) : { expires: -1 };
			if ( parsed.expires && parsed.expires <= now ) {
				div.removeAttribute( key );
			} else {
				return parsed.data;
			}
		} else {
			if ( value === null ) {
				div.removeAttribute( key );
			} else {
				// we need to get the previous value in case we need to rollback
				prevValue = div.getAttribute( key );
				parsed = JSON.stringify({
					data: value,
					expires: (options.expires ? (now + options.expires) : null)
				});
				div.setAttribute( key, parsed );
			}
		}

		try {
			div.save( attrKey );
		// quota exceeded
		} catch ( error ) {
			// roll the value back to the previous value
			if ( prevValue === null ) {
				div.removeAttribute( key );
			} else {
				div.setAttribute( key, prevValue );
			}

			// expire old data and try again
			store.userData();
			try {
				div.setAttribute( key, parsed );
				div.save( attrKey );
			} catch ( error ) {
				// roll the value back to the previous value
				if ( prevValue === null ) {
					div.removeAttribute( key );
				} else {
					div.setAttribute( key, prevValue );
				}
				throw store.error();
			}
		}
		return ret;
	});
}() );

// in-memory storage
// fallback for all browsers to enable the API even if we can't persist data
(function() {
	var memory = {},
		timeout = {};

	function copy( obj ) {
		return obj === undefined ? undefined : JSON.parse( JSON.stringify( obj ) );
	}

	store.addType( "memory", function( key, value, options ) {
		if ( !key ) {
			return copy( memory );
		}

		if ( value === undefined ) {
			return copy( memory[ key ] );
		}

		if ( timeout[ key ] ) {
			clearTimeout( timeout[ key ] );
			delete timeout[ key ];
		}

		if ( value === null ) {
			delete memory[ key ];
			return null;
		}

		memory[ key ] = value;
		if ( options.expires ) {
			timeout[ key ] = setTimeout(function() {
				delete memory[ key ];
				delete timeout[ key ];
			}, options.expires );
		}

		return value;
	});
}() );

}( this.amplify = this.amplify || {} ) );

/*global amplify*/

(function( amplify, undefined ) {
'use strict';

function noop() {}
function isFunction( obj ) {
	return ({}).toString.call( obj ) === "[object Function]";
}

function async( fn ) {
	var isAsync = false;
	setTimeout(function() {
		isAsync = true;
	}, 1 );
	return function() {
		var that = this,
			args = arguments;
		if ( isAsync ) {
			fn.apply( that, args );
		} else {
			setTimeout(function() {
				fn.apply( that, args );
			}, 1 );
		}
	};
}

amplify.request = function( resourceId, data, callback ) {
	// default to an empty hash just so we can handle a missing resourceId
	// in one place
	var settings = resourceId || {};

	if ( typeof settings === "string" ) {
		if ( isFunction( data ) ) {
			callback = data;
			data = {};
		}
		settings = {
			resourceId: resourceId,
			data: data || {},
			success: callback
		};
	}

	var request = { abort: noop },
		resource = amplify.request.resources[ settings.resourceId ],
		success = settings.success || noop,
		error = settings.error || noop;

	settings.success = async( function( data, status ) {
		status = status || "success";
		amplify.publish( "request.success", settings, data, status );
		amplify.publish( "request.complete", settings, data, status );
		success( data, status );
	});

	settings.error = async( function( data, status ) {
		status = status || "error";
		amplify.publish( "request.error", settings, data, status );
		amplify.publish( "request.complete", settings, data, status );
		error( data, status );
	});

	if ( !resource ) {
		if ( !settings.resourceId ) {
			throw "amplify.request: no resourceId provided";
		}
		throw "amplify.request: unknown resourceId: " + settings.resourceId;
	}

	if ( !amplify.publish( "request.before", settings ) ) {
		settings.error( null, "abort" );
		return;
	}

	amplify.request.resources[ settings.resourceId ]( settings, request );
	return request;
};

amplify.request.types = {};
amplify.request.resources = {};
amplify.request.define = function( resourceId, type, settings ) {
	if ( typeof type === "string" ) {
		if ( !( type in amplify.request.types ) ) {
			throw "amplify.request.define: unknown type: " + type;
		}

		settings.resourceId = resourceId;
		amplify.request.resources[ resourceId ] =
			amplify.request.types[ type ]( settings );
	} else {
		// no pre-processor or settings for one-off types (don't invoke)
		amplify.request.resources[ resourceId ] = type;
	}
};

}( amplify ) );


(function( amplify, $, undefined ) {
'use strict';

var xhrProps = [ "status", "statusText", "responseText", "responseXML", "readyState" ],
		rurlData = /\{([^\}]+)\}/g;

amplify.request.types.ajax = function( defnSettings ) {
	defnSettings = $.extend({
		type: "GET"
	}, defnSettings );

	return function( settings, request ) {
		var xhr, handleResponse,
			url = defnSettings.url,
			abort = request.abort,
			ajaxSettings = $.extend( true, {}, defnSettings, { data: settings.data } ),
			aborted = false,
			ampXHR = {
				readyState: 0,
				setRequestHeader: function( name, value ) {
					return xhr.setRequestHeader( name, value );
				},
				getAllResponseHeaders: function() {
					return xhr.getAllResponseHeaders();
				},
				getResponseHeader: function( key ) {
					return xhr.getResponseHeader( key );
				},
				overrideMimeType: function( type ) {
					return xhr.overrideMimeType( type );
				},
				abort: function() {
					aborted = true;
					try {
						xhr.abort();
					// IE 7 throws an error when trying to abort
					} catch( e ) {}
					handleResponse( null, "abort" );
				},
				success: function( data, status ) {
					settings.success( data, status );
				},
				error: function( data, status ) {
					settings.error( data, status );
				}
			};

		handleResponse = function( data, status ) {
			$.each( xhrProps, function( i, key ) {
				try {
					ampXHR[ key ] = xhr[ key ];
				} catch( e ) {}
			});
			// Playbook returns "HTTP/1.1 200 OK"
			// TODO: something also returns "OK", what?
			if ( /OK$/.test( ampXHR.statusText ) ) {
				ampXHR.statusText = "success";
			}
			if ( data === undefined ) {
				// TODO: add support for ajax errors with data
				data = null;
			}
			if ( aborted ) {
				status = "abort";
			}
			if ( /timeout|error|abort/.test( status ) ) {
				ampXHR.error( data, status );
			} else {
				ampXHR.success( data, status );
			}
			// avoid handling a response multiple times
			// this can happen if a request is aborted
			// TODO: figure out if this breaks polling or multi-part responses
			handleResponse = $.noop;
		};

		amplify.publish( "request.ajax.preprocess",
			defnSettings, settings, ajaxSettings, ampXHR );

		$.extend( ajaxSettings, {
			isJSONP: function () {
				return (/jsonp/gi).test(this.dataType);
			},
			cacheURL: function () {
				if (!this.isJSONP()) {
					return this.url;
				}

				var callbackName = 'callback';

				// possible for the callback function name to be overridden
				if (this.hasOwnProperty('jsonp')) {
					if (this.jsonp !== false) {
						callbackName = this.jsonp;
					} else {
						if (this.hasOwnProperty('jsonpCallback')) {
							callbackName = this.jsonpCallback;
						}
					}
				}

				// search and replace callback parameter in query string with empty string
				var callbackRegex = new RegExp('&?' + callbackName + '=[^&]*&?', 'gi');
				return this.url.replace(callbackRegex, '');
			},
			success: function( data, status ) {
				handleResponse( data, status );
			},
			error: function( _xhr, status ) {
				handleResponse( null, status );
			},
			beforeSend: function( _xhr, _ajaxSettings ) {
				xhr = _xhr;
				ajaxSettings = _ajaxSettings;
				var ret = defnSettings.beforeSend ?
					defnSettings.beforeSend.call( this, ampXHR, ajaxSettings ) : true;
				return ret && amplify.publish( "request.before.ajax",
					defnSettings, settings, ajaxSettings, ampXHR );
			}
		});

		// cache all JSONP requests
		if (ajaxSettings.cache && ajaxSettings.isJSONP()) {
			$.extend(ajaxSettings, {
				cache: true
			});
		}

		$.ajax( ajaxSettings );

		request.abort = function() {
			ampXHR.abort();
			abort.call( this );
		};
	};
};



amplify.subscribe( "request.ajax.preprocess", function( defnSettings, settings, ajaxSettings ) {
	var mappedKeys = [],
		data = ajaxSettings.data;

	if ( typeof data === "string" ) {
		return;
	}

	data = $.extend( true, {}, defnSettings.data, data );

	ajaxSettings.url = ajaxSettings.url.replace( rurlData, function ( m, key ) {
		if ( key in data ) {
			mappedKeys.push( key );
			return data[ key ];
		}
	});

	// We delete the keys later so duplicates are still replaced
	$.each( mappedKeys, function ( i, key ) {
		delete data[ key ];
	});

	ajaxSettings.data = data;
});



amplify.subscribe( "request.ajax.preprocess", function( defnSettings, settings, ajaxSettings ) {
	var data = ajaxSettings.data,
		dataMap = defnSettings.dataMap;

	if ( !dataMap || typeof data === "string" ) {
		return;
	}

	if ( $.isFunction( dataMap ) ) {
		ajaxSettings.data = dataMap( data );
	} else {
		$.each( defnSettings.dataMap, function( orig, replace ) {
			if ( orig in data ) {
				data[ replace ] = data[ orig ];
				delete data[ orig ];
			}
		});
		ajaxSettings.data = data;
	}
});



var cache = amplify.request.cache = {
	_key: function( resourceId, url, data ) {
		data = url + data;
		var length = data.length,
			i = 0;

		/*jshint bitwise:false*/
		function chunk() {
			return data.charCodeAt( i++ ) << 24 |
				data.charCodeAt( i++ ) << 16 |
				data.charCodeAt( i++ ) << 8 |
				data.charCodeAt( i++ ) << 0;
		}

		var checksum = chunk();
		while ( i < length ) {
			checksum ^= chunk();
		}
		/*jshint bitwise:true*/

		return "request-" + resourceId + "-" + checksum;
	},

	_default: (function() {
		var memoryStore = {};
		return function( resource, settings, ajaxSettings, ampXHR ) {
			// data is already converted to a string by the time we get here
			var cacheKey = cache._key( settings.resourceId,
					ajaxSettings.cacheURL(), ajaxSettings.data ),
				duration = resource.cache;

			if ( cacheKey in memoryStore ) {
				ampXHR.success( memoryStore[ cacheKey ] );
				return false;
			}
			var success = ampXHR.success;
			ampXHR.success = function( data ) {
				memoryStore[ cacheKey ] = data;
				if ( typeof duration === "number" ) {
					setTimeout(function() {
						delete memoryStore[ cacheKey ];
					}, duration );
				}
				success.apply( this, arguments );
			};
		};
	}())
};

if ( amplify.store ) {
	$.each( amplify.store.types, function( type ) {
		cache[ type ] = function( resource, settings, ajaxSettings, ampXHR ) {
			var cacheKey = cache._key( settings.resourceId,
					ajaxSettings.cacheURL(), ajaxSettings.data ),
				cached = amplify.store[ type ]( cacheKey );

			if ( cached ) {
				ajaxSettings.success( cached );
				return false;
			}
			var success = ampXHR.success;
			ampXHR.success = function( data ) {
				amplify.store[ type ]( cacheKey, data, { expires: resource.cache.expires } );
				success.apply( this, arguments );
			};
		};
	});
	cache.persist = cache[ amplify.store.type ];
}

amplify.subscribe( "request.before.ajax", function( resource ) {
	var cacheType = resource.cache;
	if ( cacheType ) {
		// normalize between objects and strings/booleans/numbers
		cacheType = cacheType.type || cacheType;
		return cache[ cacheType in cache ? cacheType : "_default" ]
			.apply( this, arguments );
	}
});



amplify.request.decoders = {
	// http://labs.omniti.com/labs/jsend
	jsend: function( data, status, ampXHR, success, error ) {
		if ( data.status === "success" ) {
			success( data.data );
		} else if ( data.status === "fail" ) {
			error( data.data, "fail" );
		} else if ( data.status === "error" ) {
			delete data.status;
			error( data, "error" );
		} else {
			error( null, "error" );
		}
	}
};

amplify.subscribe( "request.before.ajax", function( resource, settings, ajaxSettings, ampXHR ) {
	var _success = ampXHR.success,
		_error = ampXHR.error,
		decoder = $.isFunction( resource.decoder ) ?
			resource.decoder :
			resource.decoder in amplify.request.decoders ?
				amplify.request.decoders[ resource.decoder ] :
				amplify.request.decoders._default;

	if ( !decoder ) {
		return;
	}

	function success( data, status ) {
		_success( data, status );
	}
	function error( data, status ) {
		_error( data, status );
	}
	ampXHR.success = function( data, status ) {
		decoder( data, status, ampXHR, success, error );
	};
	ampXHR.error = function( data, status ) {
		decoder( data, status, ampXHR, success, error );
	};
});

}( amplify, jQuery ) );

define("amplify", function(){});

define('net/meisen/dissertation/ui/app/model',['jquery', 'amplify'], function ($, amplify) {

  return {

    /**
     * Method to remove all data of the current session.
     */
    clean: function () {
      $.each(amplify.store.sessionStorage(), function (storeKey) {
        amplify.store.sessionStorage(storeKey, null);
      });
    },

    /**
     * Object to handle the navigation on the page.
     */
    page: {
      getLastPage: function (fallback) {
        var lastPage = amplify.store.sessionStorage('lastPage');
        if (this.validate(lastPage)) {
          return lastPage;
        } else {
          return fallback;
        }
      },

      validate: function (page) {
        return typeof(page) == 'string' && page.trim() !== '' && page.replace(/[a-z]/g, '') == '';
      },

      update: function (lastPage) {
        if (this.validate(lastPage) && lastPage != 'index' && lastPage != 'error') {
          amplify.store.sessionStorage('lastPage', lastPage);
          return true;
        } else {
          return false;
        }
      }
    },

    /**
     * Object holding general session information.
     */
    map: {
      get: function (key, fallback) {
        var value = amplify.store.sessionStorage('map_' + key);
        value = typeof(value) == 'undefined' ? fallback : value;

        return value;
      },

      set: function (key, value) {
        amplify.store.sessionStorage('map_' + key, value);
      }
    },

    /**
     * Object holding session information.
     */
    session: {
      update: function (serverSession) {
        if (this.validate(serverSession)) {
          amplify.store.sessionStorage('session', serverSession);
          return true;
        } else {
          return false;
        }
      },

      validate: function (serverSession) {
        return $.isPlainObject(serverSession);
      },

      getCurrent: function () {
        return amplify.store.sessionStorage('session');
      }
    },

    /**
     * Object providing some functionality for serverSettings, i.e.,
     * validate, getDefault, or getCurrent.
     */
    serverSettings: {
      validate: function (serverUrl) {
        return typeof(serverUrl) === 'string' && serverUrl.trim() != '' && serverUrl.toLowerCase().indexOf('http://') == 0;
      },

      update: function (serverUrl) {
        if (this.validate(serverUrl)) {
          amplify.store.localStorage('serverUrl', serverUrl);
          return true;
        } else {
          return false;
        }
      },

      getDefault: function () {
        return (location.origin ? location.origin : location.protocol + '//' + location.hostname + (location.port ? ':' + location.port : ''));
      },

      getCurrent: function () {
        var serverUrl = amplify.store.localStorage('serverUrl');
        serverUrl = this.validate(serverUrl) ? serverUrl : this.getDefault();

        return serverUrl;
      }
    }
  };

});
define('net/meisen/dissertation/ui/app/page/index',['net/meisen/dissertation/ui/app/model'], function (model) {
  return function () {

    // get the last page 
    var page = model.page.getLastPage('main');

    // redirect to the page
    window.location.replace(page + '.html')
  };
});
define('net/meisen/dissertation/ui/app/server/tidaAPI',['jquery'], function ($) {

  return {

    getSession: function (sessionId) {

      // it is also possible to pass a session-object
      if ($.isPlainObject(sessionId)) {
        sessionId = sessionId.sessionId;
      }

      // create the data to be passed
      return {
        sessionId: sessionId
      }
    },

    /**
     * Function to provide a login on the server-side.
     *
     * @param serverUrl
     *   the url of the server
     * @param username
     *   the name of the user to be logged in
     * @param password
     *   the password to be used for the user
     * @param callback
     *   the callback to be fired when the log-in is performed
     */
    login: function (serverUrl, username, password, callback) {
      var credentials = {
        username: username,
        password: password
      };

      this.get(serverUrl, '/auth/login', credentials, callback);
    },

    /**
     * Function to invalidate the current session on server-side.
     *
     * @param serverUrl
     *   the url of the server
     * @param sessionId
     *   the id of the session to invalidate (can also be a session object)
     * @param callback
     *   the callback to be fired when the log-out is performed
     */
    logout: function (serverUrl, sessionId, callback) {
      this.get(serverUrl, '/auth/logout', this.getSession(sessionId), callback);
    },

    /**
     * Function to retrieve information about the current session.
     *
     * @param serverUrl
     *   the url of the server
     * @param sessionId
     *   the id of the session to retrieve information for
     * @param callback
     *   the callback to be fired when the information is retrieved
     */
    sessionInfo: function (serverUrl, sessionId, callback) {
      this.get(serverUrl, '/auth/userinfo', this.getSession(sessionId), callback);
    },

    uploadFile: function (serverUrl, sessionId, form, callback) {

      // it is also possible to pass a session-object
      var session = this.getSession(sessionId);

      // create the formData object
      var formData = new FormData(form.get(0));
      formData.append('sessionId', session.sessionId);

      // create the upload
      $.ajax({
        url: serverUrl + '/loader/file',
        type: 'POST',

        // custom XMLHttpRequest
        xhr: function () {

          // check if upload property exists
          var xhr = $.ajaxSettings.xhr();
          if (xhr.upload) {
            xhr.upload.addEventListener('progress', function (event) {
              // if we want to handle upload size: event.loaded vs. event.total
              // the upload is done when event.lengthComputable is false
            }, false);
          }
          return xhr;
        },
        // ajax events
        success: function (data, textStatus, jqXHR) {
          callback(true, data);
        },
        error: function (jqXHR, textStatus, errorThrown) {
          callback(false, {error: $.parseJSON(jqXHR.responseText)});
        },
        // form data
        data: formData,
        // options to tell jQuery not to process data or worry about content-type.
        cache: false,
        contentType: false,
        processData: false
      });
    },

    loadModel: function (serverUrl, sessionId, modelId, callback) {
      this.query(serverUrl, sessionId, 'LOAD "' + modelId + '"', callback);
    },

    loadData: function (serverUrl, sessionId, modelId, offset, limit, callback) {
      this.query(serverUrl, sessionId, 'SELECT RECORDS FROM "' + modelId + '" LIMIT ' + offset + ', ' + limit, callback);
    },

    deleteModel: function (serverUrl, sessionId, modelId, callback) {
      this.query(serverUrl, sessionId, 'DROP MODEL "' + modelId + '"', callback);
    },

    unloadModel: function (serverUrl, sessionId, modelId, callback) {
      this.query(serverUrl, sessionId, 'UNLOAD "' + modelId + '"', callback);
    },

    loadModelFromFile: function (serverUrl, sessionId, file, autoload, callback) {
      var session = this.getSession(sessionId);
      this.query(serverUrl, sessionId, 'LOAD FROM \'uploaded://' + session.sessionId + '/' + file + '\' SET autoload=' + autoload, callback);
    },

    getUsers: function (serverUrl, sessionId, callback) {
      this.query(serverUrl, this.getSession(sessionId), 'GET USERS', callback);
    },

    getRoles: function (serverUrl, sessionId, callback) {
      this.query(serverUrl, this.getSession(sessionId), 'GET ROLES', callback);
    },

    getModels: function (serverUrl, sessionId, callback) {
      var session = this.getSession(sessionId);
      var data = {
        object: 'models',
        sessionId: session.sessionId
      };

      this.get(serverUrl, '/query/system', data, callback);
    },

    getModelStructure: function (serverUrl, sessionId, modelId, callback) {
      var session = this.getSession(sessionId);
      var data = {
        object: 'modelmeta',
        model: modelId,
        sessionId: session.sessionId
      };

      this.get(serverUrl, '/query/system', data, callback);
    },

    insertSingleRecord: function (serverUrl, sessionId, modelId, entries, callback) {
      var fields = [];
      var values = [];
      $.each(entries, function(idx, entry) {
        fields.push(entry.id);

        var value = entry.value;
        if (value.trim() == '') {
          value = 'NULL';
        } else if (entry.metatype != 'START' && entry.metatype != 'END') {
          value = '\'' + entry.value + '\'';
        } else {
          value = entry.value;
        }
        values.push(value);
      });

      this.query(serverUrl, sessionId, 'INSERT INTO "' + modelId + '" (' + fields.join(',') + ') VALUES (' + values.join(',') + ')', callback);
    },

    insertDbData: function (serverUrl, sessionId, modelId, connection, query, structure, callback) {
      var session = this.getSession(sessionId);
      var data = {
        object: 'adddbrecords',
        sessionId: session.sessionId,
        model: modelId,
        connection: JSON.stringify(connection),
        query: query,
        structure: JSON.stringify(structure)
      };

      this.get(serverUrl, '/query/system', data, callback);
    },

    insertCsvData: function (serverUrl, sessionId, modelId, file, separator, structure, callback) {
      var session = this.getSession(sessionId);
      var data = {
        object: 'addcsvfile',
        sessionId: session.sessionId,
        model: modelId,
        file: file,
        separator: separator,
        structure: JSON.stringify(structure)
      };

      this.get(serverUrl, '/query/system', data, callback);
    },

    insertModelData: function (serverUrl, sessionId, modelId, callback) {
      var session = this.getSession(sessionId);
      var data = {
        object: 'addmodelrecords',
        sessionId: session.sessionId,
        model: modelId
      };

      this.get(serverUrl, '/query/system', data, callback);
    },

    deleteRecord: function (serverUrl, sessionId, modelId, recordId, callback) {
      this.query(serverUrl, sessionId, 'DELETE ' + recordId + ' FROM "' + modelId + '"', callback);
    },

    ping: function (serverUrl, sessionId, callback) {
      this.get(serverUrl, '/auth/ping', this.getSession(sessionId), callback);
    },

    query: function (serverUrl, sessionId, query, callback) {

      // it is also possible to pass a session-object
      var session = this.getSession(sessionId);
      var data = {
        sessionId: session.sessionId,
        query: query
      };

      $.ajax({
        dataType: 'json',
        url: serverUrl + '/query/tsql',
        data: data,
        type: 'POST'
      }).done(function (data, textStatus, jqXHR) {
        callback(true, data);
      }).error(function (jqXHR, textStatus, reason) {

        // check if we have an additional error message
        var message;
        try {
          var errorResponse = $.parseJSON(jqXHR.responseText);
          if (errorResponse.type == 'error') {
            reason = errorResponse.message;
          }
        } catch (e) {
          // nothing to do
        }
        callback(false, {error: reason});
      });
    },

    get: function (serverUrl, url, data, callback) {
      $.ajax({
        dataType: 'json',
        url: serverUrl + url,
        data: data,
        type: 'POST'
      }).done(function (data, textStatus, jqXHR) {
        callback(true, data);
      }).fail(function (jqXHR, textStatus, reason) {

        // check if we have an additional error message
        var message;
        try {
          var errorResponse = $.parseJSON(jqXHR.responseText);
          if (errorResponse.type == 'error') {
            reason = errorResponse.message;
          }
        } catch (e) {
          // nothing to do
        }

        callback(false, {error: reason});
      });
    }
  };
});
define('net/meisen/dissertation/ui/app/page/login',[
    'jquery',
    'net/meisen/dissertation/ui/app/server/tidaAPI',
    'net/meisen/dissertation/ui/app/model'
  ],
  function ($,
            tidaAPI,
            model) {

    // make sure we don't have a valid session
    var session = model.session.getCurrent();
    if (model.session.validate(session)) {

      // we redirect to the last page, default is analyze
      return function () {
        var page = model.page.getLastPage('analyze');
        page = page == 'login' ? 'analyze' : page;
        window.location.replace(page + '.html');
      };
    } else {

      // return the function to bind the functionality to the UI elements
      return function () {

        // add validation to input field
        var $serverUrl = $('#serverUrl');
        var validate = function () {
          var serverUrl = $serverUrl.val();
          var $serverUrlWrap = $serverUrl.parent();
          var $serverUrlGlyph = $formServerSettings.find('span.glyphicon');

          if (model.serverSettings.validate(serverUrl)) {
            $serverUrlWrap.removeClass('has-error');
            $serverUrlWrap.addClass('has-success');

            $serverUrlGlyph.removeClass('glyphicon-remove');
            $serverUrlGlyph.addClass('glyphicon-ok');
          } else {
            $serverUrlWrap.removeClass('has-success');
            $serverUrlWrap.addClass('has-error');

            $serverUrlGlyph.removeClass('glyphicon-ok');
            $serverUrlGlyph.addClass('glyphicon-remove');
          }
        };
        $serverUrl.keyup(validate);
        $serverUrl.on('input', validate);

        // add the setting of the serverUrl to the modal
        var $modalServerSettings = $('#modalServerSettings');
        $modalServerSettings.on('show.bs.modal', function (e) {
          $serverUrl.val(model.serverSettings.getCurrent());
          validate();
        });

        // handle click event on serverSettings
        var $formServerSettings = $('#formServerSettings');
        $formServerSettings.submit(function (event) {

          // get the values set
          var serverUrl = $serverUrl.val();
          if (model.serverSettings.update(serverUrl)) {
            $modalServerSettings.modal('hide');
          }

          // make sure the event is not further used
          event.preventDefault();
        });

        // handle click event on login
        $('#formLogin').submit(function (event) {

          // get credentials
          var username = $('#inputUser').val();
          var password = $('#inputPassword').val();

          // disable the inputs and show the loading
          var $btn = $('#btnLogin').button('loading');

          // do the login
          tidaAPI.login(model.serverSettings.getCurrent(), username, password, function (status, data) {

            if (status) {
              model.session.update(data);

              // forward to the first page
              window.location.replace('analyze.html');
            } else {
              $('#lblError').text(data.error);
              $('#calloutLoginFailed').removeClass('hide');

              // clean-up, enable button and inputs
              $btn.button('reset');
            }
          });

          // stop further propagation
          event.preventDefault();
        });
      }
    }
    ;
  });
define('net/meisen/dissertation/ui/app/page/logout',[
    'jquery',
    'net/meisen/dissertation/ui/app/server/tidaAPI',
    'net/meisen/dissertation/ui/app/model'
  ],
  function ($,
            tidaAPI,
            model) {


    return function () {
      tidaAPI.logout(model.serverSettings.getCurrent(), model.session.getCurrent(), function (status, data) {

        // remove the session for sure
        model.clean();

        if (status) {
          window.location.replace('main.html');
        } else {
          $('#panelWaiting').addClass('hide');
          $('#calloutLogoutFailed').removeClass('hide');
        }
      });
    };
  });
define('net/meisen/dissertation/ui/app/utilities',['jquery', 'net/meisen/dissertation/ui/app/model', 'net/meisen/dissertation/ui/app/server/tidaAPI'], function ($, model, tidaAPI) {

  return {

    isWebsite: function () {
      var href = window.location.href;
      if (href.indexOf('http://tida.meisen.net/') == 0 ||
          href.indexOf('http://tida.lifestripes.de/') == 0 ||
          href.indexOf('http://timedata.meisen.net/') == 0) {
        return true;
      } else {
        return false;
      }
    },

    setupNav: function ($navbar) {
      var session = model.session.getCurrent();
      if (model.session.validate(session)) {
        this.appendLogout();
        $navbar.find('[data-session="needed"]').removeClass('hide');
      } else {
        $navbar.find('[data-session="needed"]').addClass('hide');
      }

      if (this.isWebsite()) {
        $navbar.find('[data-website="needed"]').removeClass('hide');
      } else {
        $navbar.find('[data-website="needed"]').addClass('hide');
      }
    },

    getError: function (error) {

      if (error instanceof Error) {
        msg = error.message;
      } else if (typeof(error) == 'string') {
        msg = (error.trim() == '' ? 'Unspecified error' : error);
      } else if ($.isPlainObject(error)) {
        if ($.isArray(error.messages)) {
          msg = error.messages.join('</li><li>');
          msg = '<ul><li>' + msg + '</li></ul>';
        } else if (typeof(error.message) == 'string') {
          this.getError(error.message);
        } else if (typeof(error.error) == 'string') {
          this.getError(error.error);
        } else if (error.error == null) {
          msg = 'Unspecified error';
        } else {

          // fallback
          msg = error;
        }
      } else {
        // fallback
        msg = error;
      }

      return msg;
    },

    formatTime: function (time) {
      var hours = parseInt(time / 60);
      var minutes = time % 60;
      var formatted = (hours < 10 ? '0' + hours : hours) + ':' + (minutes < 10 ? '0' + minutes : minutes);

      return formatted;
    },

    appendLoading: function (parent) {
      var parentType = typeof(parent);
      parent = parentType == 'undefined' ? $('body') : (parentType == 'string' ? $(parent) : parent);

      var modalLoading = '';
      modalLoading += '<div class="modal fade" id="modalLoading" tabindex="-1" role="dialog" aria-labelledby="modalLoadingTitle" aria-hidden="true">';
      modalLoading += '  <div class="modal-dialog">';
      modalLoading += '    <div class="modal-content">';
      modalLoading += '      <div class="modal-header">';
      modalLoading += '        <h4 id="modalLoadingTitle" class="modal-title"></h4>';
      modalLoading += '      </div>';
      modalLoading += '      <div class="modal-body">';
      modalLoading += '        <div id="loadingIcon" class="text-center"><span style="font-size: 5em" class="glyphicon glyphicon-refresh glyphicon-refresh-animate"></span></div>';
      modalLoading += '        <div id="loadingFailed" class="hide bs-callout bs-callout-danger"><h4></h4><div></div></div>';
      modalLoading += '      </div>';
      modalLoading += '      <div class="modal-footer">';
      modalLoading += '        <button type="button" style="visibility:hidden" class="btn btn-primary" data-dismiss="modal">Close</button>';
      modalLoading += '      </div>';
      modalLoading += '    </div>';
      modalLoading += '  </div>';
      modalLoading += '</div>';

      // add a listener to reset everything after hiding
      var $modalLoading = $(modalLoading);
      $modalLoading.on('hidden.bs.modal', function () {
        var $loadingFailed = $modalLoading.find('#loadingFailed');

        $loadingFailed.children('h4').text('');
        $loadingFailed.children('div').text('');
        $loadingFailed.addClass('hide');

        $modalLoading.find('#modalLoadingTitle').text('');
        $modalLoading.find('button').css('visibility', 'hidden');
        $modalLoading.find('#loadingIcon').removeClass('hide');
      });

      $modalLoading.appendTo(parent);
    },

    handleLoading: function (retriever, callback, mainTitle, title, message) {
      var _ref = this;

      // just make sure there is one
      if (!$.isFunction(retriever)) {
        return;
      }

      var $modalLoading = $('#modalLoading');
      $modalLoading.find('#modalLoadingTitle').text(typeof(mainTitle) == 'undefined' ? 'Retrieving information from server...' : mainTitle);
      $modalLoading.modal({
        backdrop: 'static'
      });
      $modalLoading.modal('show');

      // call the retriever and handle the result
      retriever(function (status, data) {
        if (status) {
          $modalLoading.modal('hide');

          if ($.isFunction(callback)) {
            callback(status, data);
          }
        } else {
          var $loadingFailed = $modalLoading.find('#loadingFailed');

          $loadingFailed.children('h4').text(typeof(title) == 'undefined' ? 'Failed' : title);
          $loadingFailed.children('div').text(typeof(message) == 'undefined' ? _ref.getError(data) : message);
          $loadingFailed.removeClass('hide');

          $modalLoading.find('button').css('visibility', 'visible');
          $modalLoading.find('#loadingIcon').addClass('hide');

          // trigger the callback, even on error
          callback(status, data);
        }
      });
    },

    createLicense: function (parent) {

      var modalLicense = '';
      modalLicense += '<div id="modalLicense" data-refresh="modeldata" class="modal fade" data-type="operator" aria-labelledby="modalLicenseTitle" aria-hidden="true">';
      modalLicense += '  <div class="modal-dialog">';
      modalLicense += '    <div class="modal-content">';
      modalLicense += '      <div class="modal-header">';
      modalLicense += '        <button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>';
      modalLicense += '        <h4 class="modal-title" id="modalLicenseTitle">License</h4>';
      modalLicense += '      </div>';
      modalLicense += '      <div class="modal-body">';
      modalLicense += '        <div id="divLicense" style="max-height: 300px; overflow-y: auto;"></div>';
      modalLicense += '      </div>';
      modalLicense += '      <div class="modal-footer">';
      modalLicense += '        <button type="button" class="btn btn-default" data-dismiss="modal">Close</button>';
      modalLicense += '      </div>';
      modalLicense += '    </div>';
      modalLicense += '  </div>';
      modalLicense += '</div>';

      var $modalLicense = $(modalLicense);
      var $license = $modalLicense.find('#divLicense');
      parent.append($modalLicense);


      // add the license loading
      var _ref = this;
      $.get((this.isWebsite() ? '' : 'http://tida.meisen.net/') + 'LICENSE.txt')
        .done(function (responseText) {
          $license.html(responseText.replace(/(?:\r\n|\r|\n)/g, '<br />'));
          $license.css('font-family', 'courier new');
        }).fail(function () {
          $license.html('Unable to retrieve the license information from the server.');
        });
    },

    appendLogout: function (parent) {
      var parentType = typeof(parent);
      parent = parentType == 'undefined' ? $('body') : (parentType == 'string' ? $(parent) : parent);

      var modalLogout = '';
      modalLogout += '<div class="modal fade" id="modalLogout" tabindex="-1" role="dialog" aria-labelledby="modalLogoutTitle" aria-hidden="true">';
      modalLogout += '  <div class="modal-dialog">';
      modalLogout += '    <div class="modal-content">';
      modalLogout += '      <div class="modal-header">';
      modalLogout += '        <button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>';
      modalLogout += '        <h4 id="modalLogoutTitle" class="modal-title">Logout</h4>';
      modalLogout += '      </div>';
      modalLogout += '      <div class="modal-body">';
      modalLogout += '        <p>Do you really want to logout? All session dependent settings will be lost!</p>';
      modalLogout += '      </div>';
      modalLogout += '      <div class="modal-footer">';
      modalLogout += '        <button type="button" class="btn btn-default" data-dismiss="modal">Close</button>';
      modalLogout += '        <button id="btnLogoutVerified" type="button" class="btn btn-primary">Logout</button>';
      modalLogout += '      </div>';
      modalLogout += '    </div>';
      modalLogout += '  </div>';
      modalLogout += '</div>';

      var modalExpired = '';
      modalExpired += '<div class="modal fade" id="modalExpired" tabindex="-1" role="dialog" aria-labelledby="modalExpiredTitle" aria-hidden="true">';
      modalExpired += '  <div class="modal-dialog">';
      modalExpired += '    <div class="modal-content">';
      modalExpired += '      <div class="modal-header">';
      modalExpired += '        <h4 id="modalExpiredTitle" class="modal-title">Session expired</h4>';
      modalExpired += '      </div>';
      modalExpired += '      <div class="modal-body">';
      modalExpired += '        <p>Your session expired. All the session dependent data is lost. You can ignore this message and close it! Nevertheless, the system is in an undefined stat afterwards.</p>';
      modalExpired += '      </div>';
      modalExpired += '      <div class="modal-footer">';
      modalExpired += '        <button type="button" class="btn btn-default" data-dismiss="modal">Close (not recommended)</button>';
      modalExpired += '        <button id="btnExpiredVerified" type="button" class="btn btn-primary">Redirect</button>';
      modalExpired += '      </div>';
      modalExpired += '    </div>';
      modalExpired += '  </div>';
      modalExpired += '</div>';

      var modalSessionInfo = '';
      modalSessionInfo += '<div class="modal fade" id="modalSessionInfo" tabindex="-1" role="dialog" aria-labelledby="modalSessionInfoTitle" aria-hidden="true">';
      modalSessionInfo += '  <div class="modal-dialog">';
      modalSessionInfo += '    <div class="modal-content">';
      modalSessionInfo += '      <div class="modal-header">';
      modalSessionInfo += '        <button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>';
      modalSessionInfo += '        <h4 id="modalSessionInfoTitle" class="modal-title">Session information</h4>';
      modalSessionInfo += '      </div>';
      modalSessionInfo += '      <div class="modal-body">';
      modalSessionInfo += '        <div class="row"><div class="col-md-3">Username</div><div class="col-md-1">:</div><div id="username" class="col-md-8"></div></div>';
      modalSessionInfo += '        <div class="row"><div class="col-md-3">SessionId</div><div class="col-md-1">:</div><div id="sessionid" class="col-md-8"></div></div>';
      modalSessionInfo += '        <div class="row"><div class="col-md-3">Login time</div><div class="col-md-1">:</div><div id="logintime" class="col-md-8"></div></div>';
      modalSessionInfo += '        <div class="row"><div class="col-md-3">Timeout (hh:mm)</div><div class="col-md-1">:</div><div id="timeout" class="col-md-8"></div></div>';
      modalSessionInfo += '        <div class="row"><div class="col-md-3">Expires (hh:mm)</div><div class="col-md-1">:</div><div id="expires" class="col-md-8"></div></div>';
      modalSessionInfo += '      </div>';
      modalSessionInfo += '      <div class="modal-footer">';
      modalSessionInfo += '        <button type="button" class="btn btn-primary" data-dismiss="modal">Close</button>';
      modalSessionInfo += '      </div>';
      modalSessionInfo += '    </div>';
      modalSessionInfo += '  </div>';
      modalSessionInfo += '</div>';

      // append it
      parent.append(modalLogout);
      parent.append(modalExpired);
      parent.append(modalSessionInfo);

      // add the click for the logout button
      $('#btnLogoutVerified').click(function (event) {
        window.location.replace('logout.html');
      });
      $('#btnExpiredVerified').click(function (event) {
        window.location.replace('index.html');
      });

      // add an observer if the session expires
      var _ref = this;
      var intervalHandler = setInterval(function () {
        tidaAPI.sessionInfo(model.serverSettings.getCurrent(), model.session.getCurrent(), function (status, data) {
          if (status && !$.isEmptyObject(data) && data != null) {
            $('#username').text(data.username);
            $('#sessionid').text(data.sessionId);
            $('#logintime').text(data.logintime);
            $('#timeout').text(_ref.formatTime(data.timeoutInMin));
            $('#expires').text(_ref.formatTime(data.leftTimeoutInMin));
          } else {
            window.clearInterval(intervalHandler);
            model.clean();

            $('#modalExpired').modal({
              backdrop: 'static',
              keyboard: false
            });
            $('#modalExpired').modal('show');
          }
        });
      }, 1000);
    }
  };
});
define('net/meisen/dissertation/ui/app/page/main',['jquery', 'net/meisen/dissertation/ui/app/utilities'], function ($, util) {

  return function () {

    // determine what kind of version we are using
    if (util.isWebsite()) {
      $('#download').removeClass('hide');
    } else {
      $('#server').removeClass('hide');
    }

    // check if we can logout, i.e. if a session is available
    util.setupNav($('.navbar'));

    // add the license
    util.createLicense($('body'));
  };
});
/* =============================================================
 * bootstrap3-typeahead.js v4.0.2
 * https://github.com/bassjobsen/Bootstrap-3-Typeahead
 * =============================================================
 * Original written by @mdo and @fat
 * =============================================================
 * Copyright 2014 Bass Jobsen @bassjobsen
 *
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * ============================================================ */


(function (root, factory) {

  'use strict';

  // CommonJS module is defined
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('jquery'));
  }
  // AMD module is defined
  else if (typeof define === 'function' && define.amd) {
    define('bootstrap3-typeahead',['jquery'], function ($) {
      return factory ($);
    });
  } else {
    factory(root.jQuery);
  }

}(this, function ($) {

  'use strict';
  // jshint laxcomma: true


 /* TYPEAHEAD PUBLIC CLASS DEFINITION
  * ================================= */

  var Typeahead = function (element, options) {
    this.$element = $(element);
    this.options = $.extend({}, $.fn.typeahead.defaults, options);
    this.matcher = this.options.matcher || this.matcher;
    this.sorter = this.options.sorter || this.sorter;
    this.select = this.options.select || this.select;
    this.autoSelect = typeof this.options.autoSelect == 'boolean' ? this.options.autoSelect : true;
    this.highlighter = this.options.highlighter || this.highlighter;
    this.render = this.options.render || this.render;
    this.updater = this.options.updater || this.updater;
    this.displayText = this.options.displayText || this.displayText;
    this.source = this.options.source;
    this.delay = this.options.delay;
    this.$menu = $(this.options.menu);
    this.$appendTo = this.options.appendTo ? $(this.options.appendTo) : null;
    this.fitToElement = typeof this.options.fitToElement == 'boolean' ? this.options.fitToElement : false;
    this.shown = false;
    this.listen();
    this.showHintOnFocus = typeof this.options.showHintOnFocus == 'boolean' || this.options.showHintOnFocus === "all" ? this.options.showHintOnFocus : false;
    this.afterSelect = this.options.afterSelect;
    this.addItem = false;
    this.value = this.$element.val() || this.$element.text();
  };

  Typeahead.prototype = {

    constructor: Typeahead,

    select: function () {
      var val = this.$menu.find('.active').data('value');
      this.$element.data('active', val);
      if (this.autoSelect || val) {
        var newVal = this.updater(val);
        // Updater can be set to any random functions via "options" parameter in constructor above.
        // Add null check for cases when updater returns void or undefined.
        if (!newVal) {
          newVal = '';
        }
        this.$element
          .val(this.displayText(newVal) || newVal)
          .text(this.displayText(newVal) || newVal)
          .change();
        this.afterSelect(newVal);
      }
      return this.hide();
    },

    updater: function (item) {
      return item;
    },

    setSource: function (source) {
      this.source = source;
    },

    show: function () {
      var pos = $.extend({}, this.$element.position(), {
        height: this.$element[0].offsetHeight
      });

      var scrollHeight = typeof this.options.scrollHeight == 'function' ?
          this.options.scrollHeight.call() :
          this.options.scrollHeight;

      var element;
      if (this.shown) {
        element = this.$menu;
      } else if (this.$appendTo) {
        element = this.$menu.appendTo(this.$appendTo);
        this.hasSameParent = this.$appendTo.is(this.$element.parent());
      } else {
        element = this.$menu.insertAfter(this.$element);
        this.hasSameParent = true;
      }      
      
      if (!this.hasSameParent) {
          // We cannot rely on the element position, need to position relative to the window
          element.css("position", "fixed");
          var offset = this.$element.offset();
          pos.top =  offset.top;
          pos.left = offset.left;
      }
      // The rules for bootstrap are: 'dropup' in the parent and 'dropdown-menu-right' in the element.
      // Note that to get right alignment, you'll need to specify `menu` in the options to be:
      // '<ul class="typeahead dropdown-menu" role="listbox"></ul>'
      var dropup = $(element).parent().hasClass('dropup');
      var newTop = dropup ? 'auto' : (pos.top + pos.height + scrollHeight);
      var right = $(element).hasClass('dropdown-menu-right');
      var newLeft = right ? 'auto' : pos.left;
      // it seems like setting the css is a bad idea (just let Bootstrap do it), but I'll keep the old
      // logic in place except for the dropup/right-align cases.
      element.css({ top: newTop, left: newLeft }).show();

      if (this.options.fitToElement === true) {
          element.css("width", this.$element.outerWidth() + "px");
      }
    
      this.shown = true;
      return this;
    },

    hide: function () {
      this.$menu.hide();
      this.shown = false;
      return this;
    },

    lookup: function (query) {
      var items;
      if (typeof(query) != 'undefined' && query !== null) {
        this.query = query;
      } else {
        this.query = this.$element.val() || this.$element.text() || '';
      }

      if (this.query.length < this.options.minLength && !this.options.showHintOnFocus) {
        return this.shown ? this.hide() : this;
      }

      var worker = $.proxy(function () {

        if ($.isFunction(this.source)) {
          this.source(this.query, $.proxy(this.process, this));
        } else if (this.source) {
          this.process(this.source);
        }
      }, this);

      clearTimeout(this.lookupWorker);
      this.lookupWorker = setTimeout(worker, this.delay);
    },

    process: function (items) {
      var that = this;

      items = $.grep(items, function (item) {
        return that.matcher(item);
      });

      items = this.sorter(items);

      if (!items.length && !this.options.addItem) {
        return this.shown ? this.hide() : this;
      }

      if (items.length > 0) {
        this.$element.data('active', items[0]);
      } else {
        this.$element.data('active', null);
      }

      // Add item
      if (this.options.addItem){
        items.push(this.options.addItem);
      }

      if (this.options.items == 'all') {
        return this.render(items).show();
      } else {
        return this.render(items.slice(0, this.options.items)).show();
      }
    },

    matcher: function (item) {
      var it = this.displayText(item);
      return ~it.toLowerCase().indexOf(this.query.toLowerCase());
    },

    sorter: function (items) {
      var beginswith = [];
      var caseSensitive = [];
      var caseInsensitive = [];
      var item;

      while ((item = items.shift())) {
        var it = this.displayText(item);
        if (!it.toLowerCase().indexOf(this.query.toLowerCase())) beginswith.push(item);
        else if (~it.indexOf(this.query)) caseSensitive.push(item);
        else caseInsensitive.push(item);
      }

      return beginswith.concat(caseSensitive, caseInsensitive);
    },

    highlighter: function (item) {
      var html = $('<div></div>');
      var query = this.query;
      var i = item.toLowerCase().indexOf(query.toLowerCase());
      var len = query.length;
      var leftPart;
      var middlePart;
      var rightPart;
      var strong;
      if (len === 0) {
        return html.text(item).html();
      }
      while (i > -1) {
        leftPart = item.substr(0, i);
        middlePart = item.substr(i, len);
        rightPart = item.substr(i + len);
        strong = $('<strong></strong>').text(middlePart);
        html
          .append(document.createTextNode(leftPart))
          .append(strong);
        item = rightPart;
        i = item.toLowerCase().indexOf(query.toLowerCase());
      }
      return html.append(document.createTextNode(item)).html();
    },

    render: function (items) {
      var that = this;
      var self = this;
      var activeFound = false;
      var data = [];
      var _category = that.options.separator;

      $.each(items, function (key,value) {
        // inject separator
        if (key > 0 && value[_category] !== items[key - 1][_category]){
          data.push({
            __type: 'divider'
          });
        }

        // inject category header
        if (value[_category] && (key === 0 || value[_category] !== items[key - 1][_category])){
          data.push({
            __type: 'category',
            name: value[_category]
          });
        }
        data.push(value);
      });

      items = $(data).map(function (i, item) {
        if ((item.__type || false) == 'category'){
          return $(that.options.headerHtml).text(item.name)[0];
        }

        if ((item.__type || false) == 'divider'){
          return $(that.options.headerDivider)[0];
        }

        var text = self.displayText(item);
        i = $(that.options.item).data('value', item);
        i.find('a').html(that.highlighter(text, item));
        if (text == self.$element.val()) {
          i.addClass('active');
          self.$element.data('active', item);
          activeFound = true;
        }
        return i[0];
      });

      if (this.autoSelect && !activeFound) {
        items.filter(':not(.dropdown-header)').first().addClass('active');
        this.$element.data('active', items.first().data('value'));
      }
      this.$menu.html(items);
      return this;
    },

    displayText: function (item) {
      return typeof item !== 'undefined' && typeof item.name != 'undefined' && item.name || item;
    },

    next: function (event) {
      var active = this.$menu.find('.active').removeClass('active');
      var next = active.next();

      if (!next.length) {
        next = $(this.$menu.find('li')[0]);
      }

      next.addClass('active');
    },

    prev: function (event) {
      var active = this.$menu.find('.active').removeClass('active');
      var prev = active.prev();

      if (!prev.length) {
        prev = this.$menu.find('li').last();
      }

      prev.addClass('active');
    },

    listen: function () {
      this.$element
        .on('focus',    $.proxy(this.focus, this))
        .on('blur',     $.proxy(this.blur, this))
        .on('keypress', $.proxy(this.keypress, this))
        .on('input',    $.proxy(this.input, this))
        .on('keyup',    $.proxy(this.keyup, this));

      if (this.eventSupported('keydown')) {
        this.$element.on('keydown', $.proxy(this.keydown, this));
      }

      this.$menu
        .on('click', $.proxy(this.click, this))
        .on('mouseenter', 'li', $.proxy(this.mouseenter, this))
        .on('mouseleave', 'li', $.proxy(this.mouseleave, this))
        .on('mousedown', $.proxy(this.mousedown,this));
    },

    destroy : function () {
      this.$element.data('typeahead',null);
      this.$element.data('active',null);
      this.$element
        .off('focus')
        .off('blur')
        .off('keypress')
        .off('input')
        .off('keyup');

      if (this.eventSupported('keydown')) {
        this.$element.off('keydown');
      }

      this.$menu.remove();
      this.destroyed = true;
    },

    eventSupported: function (eventName) {
      var isSupported = eventName in this.$element;
      if (!isSupported) {
        this.$element.setAttribute(eventName, 'return;');
        isSupported = typeof this.$element[eventName] === 'function';
      }
      return isSupported;
    },

    move: function (e) {
      if (!this.shown) return;

      switch (e.keyCode) {
        case 9: // tab
        case 13: // enter
        case 27: // escape
          e.preventDefault();
          break;

        case 38: // up arrow
          // with the shiftKey (this is actually the left parenthesis)
          if (e.shiftKey) return;
          e.preventDefault();
          this.prev();
          break;

        case 40: // down arrow
          // with the shiftKey (this is actually the right parenthesis)
          if (e.shiftKey) return;
          e.preventDefault();
          this.next();
          break;
      }
    },

    keydown: function (e) {
      this.suppressKeyPressRepeat = ~$.inArray(e.keyCode, [40,38,9,13,27]);
      if (!this.shown && e.keyCode == 40) {
        this.lookup();
      } else {
        this.move(e);
      }
    },

    keypress: function (e) {
      if (this.suppressKeyPressRepeat) return;
      this.move(e);
    },

    input: function (e) {
      // This is a fixed for IE10/11 that fires the input event when a placehoder is changed
      // (https://connect.microsoft.com/IE/feedback/details/810538/ie-11-fires-input-event-on-focus)
      var currentValue = this.$element.val() || this.$element.text();
      if (this.value !== currentValue) {
        this.value = currentValue;
        this.lookup();
      }
    },

    keyup: function (e) {
      if (this.destroyed) {
        return;
      }
      switch (e.keyCode) {
        case 40: // down arrow
        case 38: // up arrow
        case 16: // shift
        case 17: // ctrl
        case 18: // alt
          break;

        case 9: // tab
        case 13: // enter
          if (!this.shown) return;
          this.select();
          break;

        case 27: // escape
          if (!this.shown) return;
          this.hide();
          break;
      }


    },

    focus: function (e) {
      if (!this.focused) {
        this.focused = true;
        if (this.options.showHintOnFocus && this.skipShowHintOnFocus !== true) {
          if(this.options.showHintOnFocus === "all") {
            this.lookup(""); 
          } else {
            this.lookup();
          }
        }
      }
      if (this.skipShowHintOnFocus) {
        this.skipShowHintOnFocus = false;
      }
    },

    blur: function (e) {
      if (!this.mousedover && !this.mouseddown && this.shown) {
        this.hide();
        this.focused = false;
      } else if (this.mouseddown) {
        // This is for IE that blurs the input when user clicks on scroll.
        // We set the focus back on the input and prevent the lookup to occur again
        this.skipShowHintOnFocus = true;
        this.$element.focus();
        this.mouseddown = false;
      } 
    },

    click: function (e) {
      e.preventDefault();
      this.skipShowHintOnFocus = true;
      this.select();
      this.$element.focus();
      this.hide();
    },

    mouseenter: function (e) {
      this.mousedover = true;
      this.$menu.find('.active').removeClass('active');
      $(e.currentTarget).addClass('active');
    },

    mouseleave: function (e) {
      this.mousedover = false;
      if (!this.focused && this.shown) this.hide();
    },

   /**
     * We track the mousedown for IE. When clicking on the menu scrollbar, IE makes the input blur thus hiding the menu.
     */
    mousedown: function (e) {
      this.mouseddown = true;
      this.$menu.one("mouseup", function(e){
        // IE won't fire this, but FF and Chrome will so we reset our flag for them here
        this.mouseddown = false;
      }.bind(this));
    },

  };


  /* TYPEAHEAD PLUGIN DEFINITION
   * =========================== */

  var old = $.fn.typeahead;

  $.fn.typeahead = function (option) {
    var arg = arguments;
    if (typeof option == 'string' && option == 'getActive') {
      return this.data('active');
    }
    return this.each(function () {
      var $this = $(this);
      var data = $this.data('typeahead');
      var options = typeof option == 'object' && option;
      if (!data) $this.data('typeahead', (data = new Typeahead(this, options)));
      if (typeof option == 'string' && data[option]) {
        if (arg.length > 1) {
          data[option].apply(data, Array.prototype.slice.call(arg, 1));
        } else {
          data[option]();
        }
      }
    });
  };

  $.fn.typeahead.defaults = {
    source: [],
    items: 8,
    menu: '<ul class="typeahead dropdown-menu" role="listbox"></ul>',
    item: '<li><a class="dropdown-item" href="#" role="option"></a></li>',
    minLength: 1,
    scrollHeight: 0,
    autoSelect: true,
    afterSelect: $.noop,
    addItem: false,
    delay: 0,
    separator: 'category',
    headerHtml: '<li class="dropdown-header"></li>',
    headerDivider: '<li class="divider" role="separator"></li>'
  };

  $.fn.typeahead.Constructor = Typeahead;

 /* TYPEAHEAD NO CONFLICT
  * =================== */

  $.fn.typeahead.noConflict = function () {
    $.fn.typeahead = old;
    return this;
  };


 /* TYPEAHEAD DATA-API
  * ================== */

  $(document).on('focus.typeahead.data-api', '[data-provide="typeahead"]', function (e) {
    var $this = $(this);
    if ($this.data('typeahead')) return;
    $this.typeahead($this.data());
  });

}));

define('net/meisen/dissertation/ui/app/page/modelmanager',[
    'jquery',
    'net/meisen/dissertation/ui/app/utilities',
    'net/meisen/dissertation/ui/app/model',
    'net/meisen/dissertation/ui/app/server/tidaAPI'
  ],
  function ($,
            util,
            model,
            tidaAPI) {

    return {
      toggleModel: function (nav, row) {
        if (row == null || typeof(row) == 'undefined') {
          nav.find('button[data-needselect="true"]').attr('disabled', 'disabled');
        } else {
          row.parent().children('tr').removeClass('info');
          row.addClass('info');

          this.setNavBar(nav, row);
        }
      },

      setNavBar: function (nav, row) {
        var selBased = nav.find('button[data-needselect="true"]');
        selBased.each(function () {
          var selBasedRow = $(this);
          var attr = selBasedRow.attr('data-value');
          if (typeof(attr) == 'undefined') {
            selBasedRow.removeAttr('disabled');
          } else {

            // validate the value
            var invert = false;
            if (attr.charAt(0) == '!') {
              invert = true;
              attr = attr.substring(1, attr.length);
            }

            var value = row.data('entity');
            value = value != null && $.isPlainObject(value) ? value[attr] : null;
            if (value != null && value === !invert) {
              selBasedRow.removeAttr('disabled');
            } else {
              selBasedRow.attr('disabled', 'disabled');
            }
          }
        });
      },

      reloadModels: function (table) {
        var _ref = this;

        table.empty();
        this.toggleModel($('#modelmanagement nav'));

        // call the server to get the models
        util.handleLoading(function (callback) {
          tidaAPI.getModels(model.serverSettings.getCurrent(), model.session.getCurrent(), callback);
        }, function (status, data) {
          if (!status) return;

          // add all the data
          $.each(data, function (index, value) {
            _ref.addModel(table, value.model, value.loaded, value.autoloaded, false);
          });

          _ref.sortModels(table);
        }, 'Reloading models...');
      },

      uploadModel: function (table, form, autoload) {
        var _ref = this;

        util.handleLoading(function (callback) {

          // upload the file
          tidaAPI.uploadFile(model.serverSettings.getCurrent(), model.session.getCurrent(), form, function (status, data) {
            if (!status) {
              callback(status, data);
              return;
            }
            if (data.length != 1) {
              callback(false, {error: 'Invalid amount of files'});
              return;
            }

            // the file is uploaded, now we have to add the model
            tidaAPI.loadModelFromFile(model.serverSettings.getCurrent(), model.session.getCurrent(), data[0].fileName, autoload, function (status, data) {
              if (status) {
                tidaAPI.getModels(model.serverSettings.getCurrent(), model.session.getCurrent(), callback);
              } else {
                callback(false, data);
              }
            });
          });
        }, function (status, data) {
          if (!status) return;

          // check the result and load the new once
          $.each(data, function (index, value) {
            if (table.find('tr td:nth-child(1):contains(' + value.model + ')').size() == 0) {
              _ref.addModel(table, value.model, value.loaded, value.autoloaded, true);
            }
          });
        }, 'Adding model...');
      },

      deleteModel: function (row) {
        var _ref = this;
        var modelId = row.data('entity').name;

        util.handleLoading(function (callback) {
          tidaAPI.deleteModel(model.serverSettings.getCurrent(), model.session.getCurrent(), modelId, callback);
        }, function (status, data) {
          if (!status) return;

          // remove the row and update menu
          row.remove();
          _ref.toggleModel($('#modelmanagement nav'));
        }, 'Deleting model "' + modelId + '"...');
      },

      loadModel: function (row) {
        var _ref = this;
        var modelId = row.data('entity').name;

        util.handleLoading(function (callback) {
          tidaAPI.loadModel(model.serverSettings.getCurrent(), model.session.getCurrent(), modelId, callback);
        }, function (status, data) {
          if (!status) return;

          // update the entry
          _ref.setModel(row, null, true, null);
        }, 'Loading model "' + modelId + '"...');
      },

      unloadModel: function (row) {
        var _ref = this;
        var modelId = row.data('entity').name;

        util.handleLoading(function (callback) {
          tidaAPI.unloadModel(model.serverSettings.getCurrent(), model.session.getCurrent(), modelId, callback);
        }, function (status, data) {
          if (!status) return;

          // update the entry
          _ref.setModel(row, null, false, null);
        }, 'Unloading model "' + modelId + '"...');
      },

      addModel: function (table, name, loaded, autoload, sort) {
        var html = '';
        html += '<tr>';
        html += '  <td></td>';
        html += '  <td class="hidden-xs hidden-sm text-center"><span class="glyphicon" aria-hidden="true"></span></td>';
        html += '  <td class="hidden-xs hidden-sm text-center"><span class="glyphicon" aria-hidden="true"></span></td>';
        html += '  <td class="text-center">';
        html += '    <button type="button" class="btn operator" aria-label="load model"><span class="glyphicon glyphicon-play" aria-hidden="true"></span></button>';
        html += '    <button type="button" class="btn operator" aria-label="unload model"><span class="glyphicon glyphicon-stop" aria-hidden="true"></span></button>';
        html += '    <button type="button" class="btn operator" data-toggle="modal" data-target="#modalDeleteModel" data-backdrop="static" aria-label="delete model"><span class="glyphicon glyphicon-trash" aria-hidden="true"></span></button>';
        html += '  </td>';
        html += '</tr>';
        var row = $(html);

        // set the values of the model and append it
        this.setModel(row, name, loaded, autoload);
        row.appendTo(table);

        // add event for click
        var _ref = this;
        row.click(function (event) {
          var target = $(event.target);
          if (target.hasClass('operator') || target.parent().hasClass('operator')) {
            // do nothing
          } else {
            _ref.toggleModel($('#modelmanagement nav'), $(this));
          }
        });

        // click load
        row.find('button:nth-child(1)').click(function () {
          _ref.loadModel(row);
        });

        // click unload
        row.find('button:nth-child(2)').click(function () {
          _ref.unloadModel(row);
        });

        // click delete
        row.find('button:nth-child(3)').click(function () {
          _ref.toggleModel($('#modelmanagement nav'), row);
        });

        if (sort === true) {
          this.sortModels(table);
        }
      },

      sortModels: function (table) {
        table.find('tr').sort(function (tr1, tr2) {
          var valTr1 = $(tr1).find('td:first').text();
          var valTr2 = $(tr2).find('td:first').text();

          return valTr1.toLowerCase() > valTr2.toLowerCase() ? 1 : -1;
        }).appendTo(table);
      },

      setIcon: function (icon, status) {
        if (status) {
          icon.addClass('glyphicon-ok');
          icon.removeClass('glyphicon-remove');
        } else {
          icon.addClass('glyphicon-remove');
          icon.removeClass('glyphicon-ok');
        }
      },

      setModel: function (row, name, loaded, autoload) {
        var data = row.data('entity');
        data = $.isPlainObject(data) ? data : {};

        if (typeof(name) != 'undefined' && name != null) {
          row.children('td:nth-child(1)').text(name);
          data.name = name;
        }

        if (typeof(loaded) == 'boolean' && loaded != null) {
          this.setIcon(row.find('td:nth-child(2) span'), loaded);
          data.loaded = loaded;
        }
        if (typeof(autoload) == 'boolean' && autoload != null) {
          this.setIcon(row.find('td:nth-child(3) span'), autoload);
          data.autoload = autoload;
        }

        // set the new entity for the object
        row.data('entity', data);

        var operators = row.children('td:nth-child(4)');
        if (data.loaded) {
          operators.children('button:nth-child(1)').attr('disabled', 'disabled');
          operators.children('button:nth-child(2)').removeAttr('disabled');
        } else {
          operators.children('button:nth-child(1)').removeAttr('disabled');
          operators.children('button:nth-child(2)').attr('disabled', 'disabled');
        }

        if (row.hasClass('info')) {
          this.setNavBar($('#modelmanagement nav'), row);
        }
      }
    };
  });
/*
 Highcharts JS v5.0.7 (2017-01-17)

 (c) 2009-2016 Torstein Honsi

 License: www.highcharts.com/license
*/
(function(L,a){"object"===typeof module&&module.exports?module.exports=L.document?a(L):a:L.Highcharts=a(L)})("undefined"!==typeof window?window:this,function(L){L=function(){var a=window,B=a.document,A=a.navigator&&a.navigator.userAgent||"",H=B&&B.createElementNS&&!!B.createElementNS("http://www.w3.org/2000/svg","svg").createSVGRect,G=/(edge|msie|trident)/i.test(A)&&!window.opera,r=!H,g=/Firefox/.test(A),f=g&&4>parseInt(A.split("Firefox/")[1],10);return a.Highcharts?a.Highcharts.error(16,!0):{product:"Highcharts",
version:"5.0.7",deg2rad:2*Math.PI/360,doc:B,hasBidiBug:f,hasTouch:B&&void 0!==B.documentElement.ontouchstart,isMS:G,isWebKit:/AppleWebKit/.test(A),isFirefox:g,isTouchDevice:/(Mobile|Android|Windows Phone)/.test(A),SVG_NS:"http://www.w3.org/2000/svg",chartCount:0,seriesTypes:{},symbolSizes:{},svg:H,vml:r,win:a,charts:[],marginNames:["plotTop","marginRight","marginBottom","plotLeft"],noop:function(){}}}();(function(a){var B=[],A=a.charts,H=a.doc,G=a.win;a.error=function(r,g){r=a.isNumber(r)?"Highcharts error #"+
r+": www.highcharts.com/errors/"+r:r;if(g)throw Error(r);G.console&&console.log(r)};a.Fx=function(a,g,f){this.options=g;this.elem=a;this.prop=f};a.Fx.prototype={dSetter:function(){var a=this.paths[0],g=this.paths[1],f=[],u=this.now,l=a.length,q;if(1===u)f=this.toD;else if(l===g.length&&1>u)for(;l--;)q=parseFloat(a[l]),f[l]=isNaN(q)?a[l]:u*parseFloat(g[l]-q)+q;else f=g;this.elem.attr("d",f,null,!0)},update:function(){var a=this.elem,g=this.prop,f=this.now,u=this.options.step;if(this[g+"Setter"])this[g+
"Setter"]();else a.attr?a.element&&a.attr(g,f,null,!0):a.style[g]=f+this.unit;u&&u.call(a,f,this)},run:function(a,g,f){var r=this,l=function(a){return l.stopped?!1:r.step(a)},q;this.startTime=+new Date;this.start=a;this.end=g;this.unit=f;this.now=this.start;this.pos=0;l.elem=this.elem;l.prop=this.prop;l()&&1===B.push(l)&&(l.timerId=setInterval(function(){for(q=0;q<B.length;q++)B[q]()||B.splice(q--,1);B.length||clearInterval(l.timerId)},13))},step:function(a){var r=+new Date,f,u=this.options;f=this.elem;
var l=u.complete,q=u.duration,d=u.curAnim,b;if(f.attr&&!f.element)f=!1;else if(a||r>=q+this.startTime){this.now=this.end;this.pos=1;this.update();a=d[this.prop]=!0;for(b in d)!0!==d[b]&&(a=!1);a&&l&&l.call(f);f=!1}else this.pos=u.easing((r-this.startTime)/q),this.now=this.start+(this.end-this.start)*this.pos,this.update(),f=!0;return f},initPath:function(r,g,f){function u(a){var e,b;for(n=a.length;n--;)e="M"===a[n]||"L"===a[n],b=/[a-zA-Z]/.test(a[n+3]),e&&b&&a.splice(n+1,0,a[n+1],a[n+2],a[n+1],a[n+
2])}function l(a,e){for(;a.length<m;){a[0]=e[m-a.length];var b=a.slice(0,t);[].splice.apply(a,[0,0].concat(b));E&&(b=a.slice(a.length-t),[].splice.apply(a,[a.length,0].concat(b)),n--)}a[0]="M"}function q(a,e){for(var b=(m-a.length)/t;0<b&&b--;)c=a.slice().splice(a.length/z-t,t*z),c[0]=e[m-t-b*t],C&&(c[t-6]=c[t-2],c[t-5]=c[t-1]),[].splice.apply(a,[a.length/z,0].concat(c)),E&&b--}g=g||"";var d,b=r.startX,p=r.endX,C=-1<g.indexOf("C"),t=C?7:3,m,c,n;g=g.split(" ");f=f.slice();var E=r.isArea,z=E?2:1,e;
C&&(u(g),u(f));if(b&&p){for(n=0;n<b.length;n++)if(b[n]===p[0]){d=n;break}else if(b[0]===p[p.length-b.length+n]){d=n;e=!0;break}void 0===d&&(g=[])}g.length&&a.isNumber(d)&&(m=f.length+d*z*t,e?(l(g,f),q(f,g)):(l(f,g),q(g,f)));return[g,f]}};a.extend=function(a,g){var f;a||(a={});for(f in g)a[f]=g[f];return a};a.merge=function(){var r,g=arguments,f,u={},l=function(q,d){var b,p;"object"!==typeof q&&(q={});for(p in d)d.hasOwnProperty(p)&&(b=d[p],a.isObject(b,!0)&&"renderTo"!==p&&"number"!==typeof b.nodeType?
q[p]=l(q[p]||{},b):q[p]=d[p]);return q};!0===g[0]&&(u=g[1],g=Array.prototype.slice.call(g,2));f=g.length;for(r=0;r<f;r++)u=l(u,g[r]);return u};a.pInt=function(a,g){return parseInt(a,g||10)};a.isString=function(a){return"string"===typeof a};a.isArray=function(a){a=Object.prototype.toString.call(a);return"[object Array]"===a||"[object Array Iterator]"===a};a.isObject=function(r,g){return r&&"object"===typeof r&&(!g||!a.isArray(r))};a.isNumber=function(a){return"number"===typeof a&&!isNaN(a)};a.erase=
function(a,g){for(var f=a.length;f--;)if(a[f]===g){a.splice(f,1);break}};a.defined=function(a){return void 0!==a&&null!==a};a.attr=function(r,g,f){var u,l;if(a.isString(g))a.defined(f)?r.setAttribute(g,f):r&&r.getAttribute&&(l=r.getAttribute(g));else if(a.defined(g)&&a.isObject(g))for(u in g)r.setAttribute(u,g[u]);return l};a.splat=function(r){return a.isArray(r)?r:[r]};a.syncTimeout=function(a,g,f){if(g)return setTimeout(a,g,f);a.call(0,f)};a.pick=function(){var a=arguments,g,f,u=a.length;for(g=
0;g<u;g++)if(f=a[g],void 0!==f&&null!==f)return f};a.css=function(r,g){a.isMS&&!a.svg&&g&&void 0!==g.opacity&&(g.filter="alpha(opacity\x3d"+100*g.opacity+")");a.extend(r.style,g)};a.createElement=function(r,g,f,u,l){r=H.createElement(r);var q=a.css;g&&a.extend(r,g);l&&q(r,{padding:0,border:"none",margin:0});f&&q(r,f);u&&u.appendChild(r);return r};a.extendClass=function(r,g){var f=function(){};f.prototype=new r;a.extend(f.prototype,g);return f};a.pad=function(a,g,f){return Array((g||2)+1-String(a).length).join(f||
0)+a};a.relativeLength=function(a,g){return/%$/.test(a)?g*parseFloat(a)/100:parseFloat(a)};a.wrap=function(a,g,f){var r=a[g];a[g]=function(){var a=Array.prototype.slice.call(arguments),q=arguments,d=this;d.proceed=function(){r.apply(d,arguments.length?arguments:q)};a.unshift(r);a=f.apply(this,a);d.proceed=null;return a}};a.getTZOffset=function(r){var g=a.Date;return 6E4*(g.hcGetTimezoneOffset&&g.hcGetTimezoneOffset(r)||g.hcTimezoneOffset||0)};a.dateFormat=function(r,g,f){if(!a.defined(g)||isNaN(g))return a.defaultOptions.lang.invalidDate||
"";r=a.pick(r,"%Y-%m-%d %H:%M:%S");var u=a.Date,l=new u(g-a.getTZOffset(g)),q,d=l[u.hcGetHours](),b=l[u.hcGetDay](),p=l[u.hcGetDate](),C=l[u.hcGetMonth](),t=l[u.hcGetFullYear](),m=a.defaultOptions.lang,c=m.weekdays,n=m.shortWeekdays,E=a.pad,u=a.extend({a:n?n[b]:c[b].substr(0,3),A:c[b],d:E(p),e:E(p,2," "),w:b,b:m.shortMonths[C],B:m.months[C],m:E(C+1),y:t.toString().substr(2,2),Y:t,H:E(d),k:d,I:E(d%12||12),l:d%12||12,M:E(l[u.hcGetMinutes]()),p:12>d?"AM":"PM",P:12>d?"am":"pm",S:E(l.getSeconds()),L:E(Math.round(g%
1E3),3)},a.dateFormats);for(q in u)for(;-1!==r.indexOf("%"+q);)r=r.replace("%"+q,"function"===typeof u[q]?u[q](g):u[q]);return f?r.substr(0,1).toUpperCase()+r.substr(1):r};a.formatSingle=function(r,g){var f=/\.([0-9])/,u=a.defaultOptions.lang;/f$/.test(r)?(f=(f=r.match(f))?f[1]:-1,null!==g&&(g=a.numberFormat(g,f,u.decimalPoint,-1<r.indexOf(",")?u.thousandsSep:""))):g=a.dateFormat(r,g);return g};a.format=function(r,g){for(var f="{",u=!1,l,q,d,b,p=[],C;r;){f=r.indexOf(f);if(-1===f)break;l=r.slice(0,
f);if(u){l=l.split(":");q=l.shift().split(".");b=q.length;C=g;for(d=0;d<b;d++)C=C[q[d]];l.length&&(C=a.formatSingle(l.join(":"),C));p.push(C)}else p.push(l);r=r.slice(f+1);f=(u=!u)?"}":"{"}p.push(r);return p.join("")};a.getMagnitude=function(a){return Math.pow(10,Math.floor(Math.log(a)/Math.LN10))};a.normalizeTickInterval=function(r,g,f,u,l){var q,d=r;f=a.pick(f,1);q=r/f;g||(g=l?[1,1.2,1.5,2,2.5,3,4,5,6,8,10]:[1,2,2.5,5,10],!1===u&&(1===f?g=a.grep(g,function(a){return 0===a%1}):.1>=f&&(g=[1/f])));
for(u=0;u<g.length&&!(d=g[u],l&&d*f>=r||!l&&q<=(g[u]+(g[u+1]||g[u]))/2);u++);return d=a.correctFloat(d*f,-Math.round(Math.log(.001)/Math.LN10))};a.stableSort=function(a,g){var f=a.length,r,l;for(l=0;l<f;l++)a[l].safeI=l;a.sort(function(a,d){r=g(a,d);return 0===r?a.safeI-d.safeI:r});for(l=0;l<f;l++)delete a[l].safeI};a.arrayMin=function(a){for(var g=a.length,f=a[0];g--;)a[g]<f&&(f=a[g]);return f};a.arrayMax=function(a){for(var g=a.length,f=a[0];g--;)a[g]>f&&(f=a[g]);return f};a.destroyObjectProperties=
function(a,g){for(var f in a)a[f]&&a[f]!==g&&a[f].destroy&&a[f].destroy(),delete a[f]};a.discardElement=function(r){var g=a.garbageBin;g||(g=a.createElement("div"));r&&g.appendChild(r);g.innerHTML=""};a.correctFloat=function(a,g){return parseFloat(a.toPrecision(g||14))};a.setAnimation=function(r,g){g.renderer.globalAnimation=a.pick(r,g.options.chart.animation,!0)};a.animObject=function(r){return a.isObject(r)?a.merge(r):{duration:r?500:0}};a.timeUnits={millisecond:1,second:1E3,minute:6E4,hour:36E5,
day:864E5,week:6048E5,month:24192E5,year:314496E5};a.numberFormat=function(r,g,f,u){r=+r||0;g=+g;var l=a.defaultOptions.lang,q=(r.toString().split(".")[1]||"").length,d,b;-1===g?g=Math.min(q,20):a.isNumber(g)||(g=2);b=(Math.abs(r)+Math.pow(10,-Math.max(g,q)-1)).toFixed(g);q=String(a.pInt(b));d=3<q.length?q.length%3:0;f=a.pick(f,l.decimalPoint);u=a.pick(u,l.thousandsSep);r=(0>r?"-":"")+(d?q.substr(0,d)+u:"");r+=q.substr(d).replace(/(\d{3})(?=\d)/g,"$1"+u);g&&(r+=f+b.slice(-g));return r};Math.easeInOutSine=
function(a){return-.5*(Math.cos(Math.PI*a)-1)};a.getStyle=function(r,g){return"width"===g?Math.min(r.offsetWidth,r.scrollWidth)-a.getStyle(r,"padding-left")-a.getStyle(r,"padding-right"):"height"===g?Math.min(r.offsetHeight,r.scrollHeight)-a.getStyle(r,"padding-top")-a.getStyle(r,"padding-bottom"):(r=G.getComputedStyle(r,void 0))&&a.pInt(r.getPropertyValue(g))};a.inArray=function(a,g){return g.indexOf?g.indexOf(a):[].indexOf.call(g,a)};a.grep=function(a,g){return[].filter.call(a,g)};a.find=function(a,
g){return[].find.call(a,g)};a.map=function(a,g){for(var f=[],u=0,l=a.length;u<l;u++)f[u]=g.call(a[u],a[u],u,a);return f};a.offset=function(a){var g=H.documentElement;a=a.getBoundingClientRect();return{top:a.top+(G.pageYOffset||g.scrollTop)-(g.clientTop||0),left:a.left+(G.pageXOffset||g.scrollLeft)-(g.clientLeft||0)}};a.stop=function(a,g){for(var f=B.length;f--;)B[f].elem!==a||g&&g!==B[f].prop||(B[f].stopped=!0)};a.each=function(a,g,f){return Array.prototype.forEach.call(a,g,f)};a.addEvent=function(r,
g,f){function u(a){a.target=a.srcElement||G;f.call(r,a)}var l=r.hcEvents=r.hcEvents||{};r.addEventListener?r.addEventListener(g,f,!1):r.attachEvent&&(r.hcEventsIE||(r.hcEventsIE={}),r.hcEventsIE[f.toString()]=u,r.attachEvent("on"+g,u));l[g]||(l[g]=[]);l[g].push(f);return function(){a.removeEvent(r,g,f)}};a.removeEvent=function(r,g,f){function u(a,b){r.removeEventListener?r.removeEventListener(a,b,!1):r.attachEvent&&(b=r.hcEventsIE[b.toString()],r.detachEvent("on"+a,b))}function l(){var a,b;if(r.nodeName)for(b in g?
(a={},a[g]=!0):a=d,a)if(d[b])for(a=d[b].length;a--;)u(b,d[b][a])}var q,d=r.hcEvents,b;d&&(g?(q=d[g]||[],f?(b=a.inArray(f,q),-1<b&&(q.splice(b,1),d[g]=q),u(g,f)):(l(),d[g]=[])):(l(),r.hcEvents={}))};a.fireEvent=function(r,g,f,u){var l;l=r.hcEvents;var q,d;f=f||{};if(H.createEvent&&(r.dispatchEvent||r.fireEvent))l=H.createEvent("Events"),l.initEvent(g,!0,!0),a.extend(l,f),r.dispatchEvent?r.dispatchEvent(l):r.fireEvent(g,l);else if(l)for(l=l[g]||[],q=l.length,f.target||a.extend(f,{preventDefault:function(){f.defaultPrevented=
!0},target:r,type:g}),g=0;g<q;g++)(d=l[g])&&!1===d.call(r,f)&&f.preventDefault();u&&!f.defaultPrevented&&u(f)};a.animate=function(r,g,f){var u,l="",q,d,b;a.isObject(f)||(u=arguments,f={duration:u[2],easing:u[3],complete:u[4]});a.isNumber(f.duration)||(f.duration=400);f.easing="function"===typeof f.easing?f.easing:Math[f.easing]||Math.easeInOutSine;f.curAnim=a.merge(g);for(b in g)a.stop(r,b),d=new a.Fx(r,f,b),q=null,"d"===b?(d.paths=d.initPath(r,r.d,g.d),d.toD=g.d,u=0,q=1):r.attr?u=r.attr(b):(u=parseFloat(a.getStyle(r,
b))||0,"opacity"!==b&&(l="px")),q||(q=g[b]),q.match&&q.match("px")&&(q=q.replace(/px/g,"")),d.run(u,q,l)};a.seriesType=function(r,g,f,u,l){var q=a.getOptions(),d=a.seriesTypes;q.plotOptions[r]=a.merge(q.plotOptions[g],f);d[r]=a.extendClass(d[g]||function(){},u);d[r].prototype.type=r;l&&(d[r].prototype.pointClass=a.extendClass(a.Point,l));return d[r]};a.uniqueKey=function(){var a=Math.random().toString(36).substring(2,9),g=0;return function(){return"highcharts-"+a+"-"+g++}}();G.jQuery&&(G.jQuery.fn.highcharts=
function(){var r=[].slice.call(arguments);if(this[0])return r[0]?(new (a[a.isString(r[0])?r.shift():"Chart"])(this[0],r[0],r[1]),this):A[a.attr(this[0],"data-highcharts-chart")]});H&&!H.defaultView&&(a.getStyle=function(r,g){var f={width:"clientWidth",height:"clientHeight"}[g];if(r.style[g])return a.pInt(r.style[g]);"opacity"===g&&(g="filter");if(f)return r.style.zoom=1,Math.max(r[f]-2*a.getStyle(r,"padding"),0);r=r.currentStyle[g.replace(/\-(\w)/g,function(a,l){return l.toUpperCase()})];"filter"===
g&&(r=r.replace(/alpha\(opacity=([0-9]+)\)/,function(a,l){return l/100}));return""===r?1:a.pInt(r)});Array.prototype.forEach||(a.each=function(a,g,f){for(var u=0,l=a.length;u<l;u++)if(!1===g.call(f,a[u],u,a))return u});Array.prototype.indexOf||(a.inArray=function(a,g){var f,u=0;if(g)for(f=g.length;u<f;u++)if(g[u]===a)return u;return-1});Array.prototype.filter||(a.grep=function(a,g){for(var f=[],u=0,l=a.length;u<l;u++)g(a[u],u)&&f.push(a[u]);return f});Array.prototype.find||(a.find=function(a,g){var f,
u=a.length;for(f=0;f<u;f++)if(g(a[f],f))return a[f]})})(L);(function(a){var B=a.each,A=a.isNumber,H=a.map,G=a.merge,r=a.pInt;a.Color=function(g){if(!(this instanceof a.Color))return new a.Color(g);this.init(g)};a.Color.prototype={parsers:[{regex:/rgba\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]?(?:\.[0-9]+)?)\s*\)/,parse:function(a){return[r(a[1]),r(a[2]),r(a[3]),parseFloat(a[4],10)]}},{regex:/#([a-fA-F0-9]{2})([a-fA-F0-9]{2})([a-fA-F0-9]{2})/,parse:function(a){return[r(a[1],
16),r(a[2],16),r(a[3],16),1]}},{regex:/rgb\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*\)/,parse:function(a){return[r(a[1]),r(a[2]),r(a[3]),1]}}],names:{white:"#ffffff",black:"#000000"},init:function(g){var f,u,l,q;if((this.input=g=this.names[g]||g)&&g.stops)this.stops=H(g.stops,function(d){return new a.Color(d[1])});else for(l=this.parsers.length;l--&&!u;)q=this.parsers[l],(f=q.regex.exec(g))&&(u=q.parse(f));this.rgba=u||[]},get:function(a){var f=this.input,g=this.rgba,l;this.stops?
(l=G(f),l.stops=[].concat(l.stops),B(this.stops,function(f,d){l.stops[d]=[l.stops[d][0],f.get(a)]})):l=g&&A(g[0])?"rgb"===a||!a&&1===g[3]?"rgb("+g[0]+","+g[1]+","+g[2]+")":"a"===a?g[3]:"rgba("+g.join(",")+")":f;return l},brighten:function(a){var f,g=this.rgba;if(this.stops)B(this.stops,function(l){l.brighten(a)});else if(A(a)&&0!==a)for(f=0;3>f;f++)g[f]+=r(255*a),0>g[f]&&(g[f]=0),255<g[f]&&(g[f]=255);return this},setOpacity:function(a){this.rgba[3]=a;return this}};a.color=function(g){return new a.Color(g)}})(L);
(function(a){var B,A,H=a.addEvent,G=a.animate,r=a.attr,g=a.charts,f=a.color,u=a.css,l=a.createElement,q=a.defined,d=a.deg2rad,b=a.destroyObjectProperties,p=a.doc,C=a.each,t=a.extend,m=a.erase,c=a.grep,n=a.hasTouch,E=a.inArray,z=a.isArray,e=a.isFirefox,x=a.isMS,F=a.isObject,w=a.isString,h=a.isWebKit,y=a.merge,J=a.noop,K=a.pick,I=a.pInt,k=a.removeEvent,D=a.stop,P=a.svg,N=a.SVG_NS,S=a.symbolSizes,O=a.win;B=a.SVGElement=function(){return this};B.prototype={opacity:1,SVG_NS:N,textProps:"direction fontSize fontWeight fontFamily fontStyle color lineHeight width textDecoration textOverflow textOutline".split(" "),
init:function(a,k){this.element="span"===k?l(k):p.createElementNS(this.SVG_NS,k);this.renderer=a},animate:function(v,k,e){k=a.animObject(K(k,this.renderer.globalAnimation,!0));0!==k.duration?(e&&(k.complete=e),G(this,v,k)):this.attr(v,null,e);return this},colorGradient:function(v,k,e){var b=this.renderer,h,D,c,x,M,m,n,d,F,t,p,w=[],l;v.linearGradient?D="linearGradient":v.radialGradient&&(D="radialGradient");if(D){c=v[D];M=b.gradients;n=v.stops;t=e.radialReference;z(c)&&(v[D]=c={x1:c[0],y1:c[1],x2:c[2],
y2:c[3],gradientUnits:"userSpaceOnUse"});"radialGradient"===D&&t&&!q(c.gradientUnits)&&(x=c,c=y(c,b.getRadialAttr(t,x),{gradientUnits:"userSpaceOnUse"}));for(p in c)"id"!==p&&w.push(p,c[p]);for(p in n)w.push(n[p]);w=w.join(",");M[w]?t=M[w].attr("id"):(c.id=t=a.uniqueKey(),M[w]=m=b.createElement(D).attr(c).add(b.defs),m.radAttr=x,m.stops=[],C(n,function(v){0===v[1].indexOf("rgba")?(h=a.color(v[1]),d=h.get("rgb"),F=h.get("a")):(d=v[1],F=1);v=b.createElement("stop").attr({offset:v[0],"stop-color":d,
"stop-opacity":F}).add(m);m.stops.push(v)}));l="url("+b.url+"#"+t+")";e.setAttribute(k,l);e.gradient=w;v.toString=function(){return l}}},applyTextOutline:function(a){var v=this.element,k,e,b,c;-1!==a.indexOf("contrast")&&(a=a.replace(/contrast/g,this.renderer.getContrast(v.style.fill)));this.fakeTS=!0;this.ySetter=this.xSetter;k=[].slice.call(v.getElementsByTagName("tspan"));a=a.split(" ");e=a[a.length-1];(b=a[0])&&"none"!==b&&(b=b.replace(/(^[\d\.]+)(.*?)$/g,function(a,v,k){return 2*v+k}),C(k,function(a){"highcharts-text-outline"===
a.getAttribute("class")&&m(k,v.removeChild(a))}),c=v.firstChild,C(k,function(a,k){0===k&&(a.setAttribute("x",v.getAttribute("x")),k=v.getAttribute("y"),a.setAttribute("y",k||0),null===k&&v.setAttribute("y",0));a=a.cloneNode(1);r(a,{"class":"highcharts-text-outline",fill:e,stroke:e,"stroke-width":b,"stroke-linejoin":"round"});v.insertBefore(a,c)}))},attr:function(a,k,e,b){var v,c=this.element,h,x=this,M;"string"===typeof a&&void 0!==k&&(v=a,a={},a[v]=k);if("string"===typeof a)x=(this[a+"Getter"]||
this._defaultGetter).call(this,a,c);else{for(v in a)k=a[v],M=!1,b||D(this,v),this.symbolName&&/^(x|y|width|height|r|start|end|innerR|anchorX|anchorY)/.test(v)&&(h||(this.symbolAttr(a),h=!0),M=!0),!this.rotation||"x"!==v&&"y"!==v||(this.doTransform=!0),M||(M=this[v+"Setter"]||this._defaultSetter,M.call(this,k,v,c),this.shadows&&/^(width|height|visibility|x|y|d|transform|cx|cy|r)$/.test(v)&&this.updateShadows(v,k,M));this.doTransform&&(this.updateTransform(),this.doTransform=!1)}e&&e();return x},updateShadows:function(a,
k,e){for(var v=this.shadows,b=v.length;b--;)e.call(v[b],"height"===a?Math.max(k-(v[b].cutHeight||0),0):"d"===a?this.d:k,a,v[b])},addClass:function(a,k){var v=this.attr("class")||"";-1===v.indexOf(a)&&(k||(a=(v+(v?" ":"")+a).replace("  "," ")),this.attr("class",a));return this},hasClass:function(a){return-1!==r(this.element,"class").indexOf(a)},removeClass:function(a){r(this.element,"class",(r(this.element,"class")||"").replace(a,""));return this},symbolAttr:function(a){var v=this;C("x y r start end width height innerR anchorX anchorY".split(" "),
function(k){v[k]=K(a[k],v[k])});v.attr({d:v.renderer.symbols[v.symbolName](v.x,v.y,v.width,v.height,v)})},clip:function(a){return this.attr("clip-path",a?"url("+this.renderer.url+"#"+a.id+")":"none")},crisp:function(a,k){var v,e={},b;k=k||a.strokeWidth||0;b=Math.round(k)%2/2;a.x=Math.floor(a.x||this.x||0)+b;a.y=Math.floor(a.y||this.y||0)+b;a.width=Math.floor((a.width||this.width||0)-2*b);a.height=Math.floor((a.height||this.height||0)-2*b);q(a.strokeWidth)&&(a.strokeWidth=k);for(v in a)this[v]!==a[v]&&
(this[v]=e[v]=a[v]);return e},css:function(a){var v=this.styles,k={},e=this.element,b,c,h="";b=!v;var D=["textOverflow","width"];a&&a.color&&(a.fill=a.color);if(v)for(c in a)a[c]!==v[c]&&(k[c]=a[c],b=!0);if(b){b=this.textWidth=a&&a.width&&"text"===e.nodeName.toLowerCase()&&I(a.width)||this.textWidth;v&&(a=t(v,k));this.styles=a;b&&!P&&this.renderer.forExport&&delete a.width;if(x&&!P)u(this.element,a);else{v=function(a,v){return"-"+v.toLowerCase()};for(c in a)-1===E(c,D)&&(h+=c.replace(/([A-Z])/g,v)+
":"+a[c]+";");h&&r(e,"style",h)}this.added&&(b&&this.renderer.buildText(this),a&&a.textOutline&&this.applyTextOutline(a.textOutline))}return this},strokeWidth:function(){return this["stroke-width"]||0},on:function(a,k){var v=this,e=v.element;n&&"click"===a?(e.ontouchstart=function(a){v.touchEventFired=Date.now();a.preventDefault();k.call(e,a)},e.onclick=function(a){(-1===O.navigator.userAgent.indexOf("Android")||1100<Date.now()-(v.touchEventFired||0))&&k.call(e,a)}):e["on"+a]=k;return this},setRadialReference:function(a){var v=
this.renderer.gradients[this.element.gradient];this.element.radialReference=a;v&&v.radAttr&&v.animate(this.renderer.getRadialAttr(a,v.radAttr));return this},translate:function(a,k){return this.attr({translateX:a,translateY:k})},invert:function(a){this.inverted=a;this.updateTransform();return this},updateTransform:function(){var a=this.translateX||0,k=this.translateY||0,e=this.scaleX,b=this.scaleY,c=this.inverted,h=this.rotation,D=this.element;c&&(a+=this.width,k+=this.height);a=["translate("+a+","+
k+")"];c?a.push("rotate(90) scale(-1,1)"):h&&a.push("rotate("+h+" "+(D.getAttribute("x")||0)+" "+(D.getAttribute("y")||0)+")");(q(e)||q(b))&&a.push("scale("+K(e,1)+" "+K(b,1)+")");a.length&&D.setAttribute("transform",a.join(" "))},toFront:function(){var a=this.element;a.parentNode.appendChild(a);return this},align:function(a,k,e){var v,b,c,h,D={};b=this.renderer;c=b.alignedObjects;var x,y;if(a){if(this.alignOptions=a,this.alignByTranslate=k,!e||w(e))this.alignTo=v=e||"renderer",m(c,this),c.push(this),
e=null}else a=this.alignOptions,k=this.alignByTranslate,v=this.alignTo;e=K(e,b[v],b);v=a.align;b=a.verticalAlign;c=(e.x||0)+(a.x||0);h=(e.y||0)+(a.y||0);"right"===v?x=1:"center"===v&&(x=2);x&&(c+=(e.width-(a.width||0))/x);D[k?"translateX":"x"]=Math.round(c);"bottom"===b?y=1:"middle"===b&&(y=2);y&&(h+=(e.height-(a.height||0))/y);D[k?"translateY":"y"]=Math.round(h);this[this.placed?"animate":"attr"](D);this.placed=!0;this.alignAttr=D;return this},getBBox:function(a,k){var v,e=this.renderer,b,c=this.element,
h=this.styles,D,x=this.textStr,m,y=e.cache,n=e.cacheKeys,F;k=K(k,this.rotation);b=k*d;D=h&&h.fontSize;void 0!==x&&(F=x.toString(),-1===F.indexOf("\x3c")&&(F=F.replace(/[0-9]/g,"0")),F+=["",k||0,D,h&&h.width,h&&h.textOverflow].join());F&&!a&&(v=y[F]);if(!v){if(c.namespaceURI===this.SVG_NS||e.forExport){try{(m=this.fakeTS&&function(a){C(c.querySelectorAll(".highcharts-text-outline"),function(v){v.style.display=a})})&&m("none"),v=c.getBBox?t({},c.getBBox()):{width:c.offsetWidth,height:c.offsetHeight},
m&&m("")}catch(W){}if(!v||0>v.width)v={width:0,height:0}}else v=this.htmlGetBBox();e.isSVG&&(a=v.width,e=v.height,h&&"11px"===h.fontSize&&17===Math.round(e)&&(v.height=e=14),k&&(v.width=Math.abs(e*Math.sin(b))+Math.abs(a*Math.cos(b)),v.height=Math.abs(e*Math.cos(b))+Math.abs(a*Math.sin(b))));if(F&&0<v.height){for(;250<n.length;)delete y[n.shift()];y[F]||n.push(F);y[F]=v}}return v},show:function(a){return this.attr({visibility:a?"inherit":"visible"})},hide:function(){return this.attr({visibility:"hidden"})},
fadeOut:function(a){var v=this;v.animate({opacity:0},{duration:a||150,complete:function(){v.attr({y:-9999})}})},add:function(a){var v=this.renderer,k=this.element,e;a&&(this.parentGroup=a);this.parentInverted=a&&a.inverted;void 0!==this.textStr&&v.buildText(this);this.added=!0;if(!a||a.handleZ||this.zIndex)e=this.zIndexSetter();e||(a?a.element:v.box).appendChild(k);if(this.onAdd)this.onAdd();return this},safeRemoveChild:function(a){var v=a.parentNode;v&&v.removeChild(a)},destroy:function(){var a=
this.element||{},k=this.renderer.isSVG&&"SPAN"===a.nodeName&&this.parentGroup,e,b;a.onclick=a.onmouseout=a.onmouseover=a.onmousemove=a.point=null;D(this);this.clipPath&&(this.clipPath=this.clipPath.destroy());if(this.stops){for(b=0;b<this.stops.length;b++)this.stops[b]=this.stops[b].destroy();this.stops=null}this.safeRemoveChild(a);for(this.destroyShadows();k&&k.div&&0===k.div.childNodes.length;)a=k.parentGroup,this.safeRemoveChild(k.div),delete k.div,k=a;this.alignTo&&m(this.renderer.alignedObjects,
this);for(e in this)delete this[e];return null},shadow:function(a,k,e){var v=[],b,c,h=this.element,D,x,m,y;if(!a)this.destroyShadows();else if(!this.shadows){x=K(a.width,3);m=(a.opacity||.15)/x;y=this.parentInverted?"(-1,-1)":"("+K(a.offsetX,1)+", "+K(a.offsetY,1)+")";for(b=1;b<=x;b++)c=h.cloneNode(0),D=2*x+1-2*b,r(c,{isShadow:"true",stroke:a.color||"#000000","stroke-opacity":m*b,"stroke-width":D,transform:"translate"+y,fill:"none"}),e&&(r(c,"height",Math.max(r(c,"height")-D,0)),c.cutHeight=D),k?
k.element.appendChild(c):h.parentNode.insertBefore(c,h),v.push(c);this.shadows=v}return this},destroyShadows:function(){C(this.shadows||[],function(a){this.safeRemoveChild(a)},this);this.shadows=void 0},xGetter:function(a){"circle"===this.element.nodeName&&("x"===a?a="cx":"y"===a&&(a="cy"));return this._defaultGetter(a)},_defaultGetter:function(a){a=K(this[a],this.element?this.element.getAttribute(a):null,0);/^[\-0-9\.]+$/.test(a)&&(a=parseFloat(a));return a},dSetter:function(a,k,e){a&&a.join&&(a=
a.join(" "));/(NaN| {2}|^$)/.test(a)&&(a="M 0 0");e.setAttribute(k,a);this[k]=a},dashstyleSetter:function(a){var v,k=this["stroke-width"];"inherit"===k&&(k=1);if(a=a&&a.toLowerCase()){a=a.replace("shortdashdotdot","3,1,1,1,1,1,").replace("shortdashdot","3,1,1,1").replace("shortdot","1,1,").replace("shortdash","3,1,").replace("longdash","8,3,").replace(/dot/g,"1,3,").replace("dash","4,3,").replace(/,$/,"").split(",");for(v=a.length;v--;)a[v]=I(a[v])*k;a=a.join(",").replace(/NaN/g,"none");this.element.setAttribute("stroke-dasharray",
a)}},alignSetter:function(a){this.element.setAttribute("text-anchor",{left:"start",center:"middle",right:"end"}[a])},opacitySetter:function(a,k,e){this[k]=a;e.setAttribute(k,a)},titleSetter:function(a){var v=this.element.getElementsByTagName("title")[0];v||(v=p.createElementNS(this.SVG_NS,"title"),this.element.appendChild(v));v.firstChild&&v.removeChild(v.firstChild);v.appendChild(p.createTextNode(String(K(a),"").replace(/<[^>]*>/g,"")))},textSetter:function(a){a!==this.textStr&&(delete this.bBox,
this.textStr=a,this.added&&this.renderer.buildText(this))},fillSetter:function(a,k,e){"string"===typeof a?e.setAttribute(k,a):a&&this.colorGradient(a,k,e)},visibilitySetter:function(a,k,e){"inherit"===a?e.removeAttribute(k):e.setAttribute(k,a)},zIndexSetter:function(a,k){var v=this.renderer,e=this.parentGroup,b=(e||v).element||v.box,c,h=this.element,D;c=this.added;var x;q(a)&&(h.zIndex=a,a=+a,this[k]===a&&(c=!1),this[k]=a);if(c){(a=this.zIndex)&&e&&(e.handleZ=!0);k=b.childNodes;for(x=0;x<k.length&&
!D;x++)e=k[x],c=e.zIndex,e!==h&&(I(c)>a||!q(a)&&q(c)||0>a&&!q(c)&&b!==v.box)&&(b.insertBefore(h,e),D=!0);D||b.appendChild(h)}return D},_defaultSetter:function(a,k,e){e.setAttribute(k,a)}};B.prototype.yGetter=B.prototype.xGetter;B.prototype.translateXSetter=B.prototype.translateYSetter=B.prototype.rotationSetter=B.prototype.verticalAlignSetter=B.prototype.scaleXSetter=B.prototype.scaleYSetter=function(a,k){this[k]=a;this.doTransform=!0};B.prototype["stroke-widthSetter"]=B.prototype.strokeSetter=function(a,
k,e){this[k]=a;this.stroke&&this["stroke-width"]?(B.prototype.fillSetter.call(this,this.stroke,"stroke",e),e.setAttribute("stroke-width",this["stroke-width"]),this.hasStroke=!0):"stroke-width"===k&&0===a&&this.hasStroke&&(e.removeAttribute("stroke"),this.hasStroke=!1)};A=a.SVGRenderer=function(){this.init.apply(this,arguments)};A.prototype={Element:B,SVG_NS:N,init:function(a,k,b,c,D,x){var v;c=this.createElement("svg").attr({version:"1.1","class":"highcharts-root"}).css(this.getStyle(c));v=c.element;
a.appendChild(v);-1===a.innerHTML.indexOf("xmlns")&&r(v,"xmlns",this.SVG_NS);this.isSVG=!0;this.box=v;this.boxWrapper=c;this.alignedObjects=[];this.url=(e||h)&&p.getElementsByTagName("base").length?O.location.href.replace(/#.*?$/,"").replace(/<[^>]*>/g,"").replace(/([\('\)])/g,"\\$1").replace(/ /g,"%20"):"";this.createElement("desc").add().element.appendChild(p.createTextNode("Created with Highcharts 5.0.7"));this.defs=this.createElement("defs").add();this.allowHTML=x;this.forExport=D;this.gradients=
{};this.cache={};this.cacheKeys=[];this.imgCount=0;this.setSize(k,b,!1);var m;e&&a.getBoundingClientRect&&(k=function(){u(a,{left:0,top:0});m=a.getBoundingClientRect();u(a,{left:Math.ceil(m.left)-m.left+"px",top:Math.ceil(m.top)-m.top+"px"})},k(),this.unSubPixelFix=H(O,"resize",k))},getStyle:function(a){return this.style=t({fontFamily:'"Lucida Grande", "Lucida Sans Unicode", Arial, Helvetica, sans-serif',fontSize:"12px"},a)},setStyle:function(a){this.boxWrapper.css(this.getStyle(a))},isHidden:function(){return!this.boxWrapper.getBBox().width},
destroy:function(){var a=this.defs;this.box=null;this.boxWrapper=this.boxWrapper.destroy();b(this.gradients||{});this.gradients=null;a&&(this.defs=a.destroy());this.unSubPixelFix&&this.unSubPixelFix();return this.alignedObjects=null},createElement:function(a){var k=new this.Element;k.init(this,a);return k},draw:J,getRadialAttr:function(a,k){return{cx:a[0]-a[2]/2+k.cx*a[2],cy:a[1]-a[2]/2+k.cy*a[2],r:k.r*a[2]}},buildText:function(a){var k=a.element,v=this,e=v.forExport,b=K(a.textStr,"").toString(),
h=-1!==b.indexOf("\x3c"),D=k.childNodes,x,m,y,n,F=r(k,"x"),d=a.styles,t=a.textWidth,w=d&&d.lineHeight,l=d&&d.textOutline,z=d&&"ellipsis"===d.textOverflow,f=d&&"nowrap"===d.whiteSpace,E=d&&d.fontSize,q,g=D.length,d=t&&!a.added&&this.box,J=function(a){var e;e=/(px|em)$/.test(a&&a.style.fontSize)?a.style.fontSize:E||v.style.fontSize||12;return w?I(w):v.fontMetrics(e,a.getAttribute("style")?a:k).h};q=[b,z,f,w,l,E,t].join();if(q!==a.textCache){for(a.textCache=q;g--;)k.removeChild(D[g]);h||l||z||t||-1!==
b.indexOf(" ")?(x=/<.*class="([^"]+)".*>/,m=/<.*style="([^"]+)".*>/,y=/<.*href="(http[^"]+)".*>/,d&&d.appendChild(k),b=h?b.replace(/<(b|strong)>/g,'\x3cspan style\x3d"font-weight:bold"\x3e').replace(/<(i|em)>/g,'\x3cspan style\x3d"font-style:italic"\x3e').replace(/<a/g,"\x3cspan").replace(/<\/(b|strong|i|em|a)>/g,"\x3c/span\x3e").split(/<br.*?>/g):[b],b=c(b,function(a){return""!==a}),C(b,function(b,c){var h,D=0;b=b.replace(/^\s+|\s+$/g,"").replace(/<span/g,"|||\x3cspan").replace(/<\/span>/g,"\x3c/span\x3e|||");
h=b.split("|||");C(h,function(b){if(""!==b||1===h.length){var d={},w=p.createElementNS(v.SVG_NS,"tspan"),l,E;x.test(b)&&(l=b.match(x)[1],r(w,"class",l));m.test(b)&&(E=b.match(m)[1].replace(/(;| |^)color([ :])/,"$1fill$2"),r(w,"style",E));y.test(b)&&!e&&(r(w,"onclick",'location.href\x3d"'+b.match(y)[1]+'"'),u(w,{cursor:"pointer"}));b=(b.replace(/<(.|\n)*?>/g,"")||" ").replace(/&lt;/g,"\x3c").replace(/&gt;/g,"\x3e");if(" "!==b){w.appendChild(p.createTextNode(b));D?d.dx=0:c&&null!==F&&(d.x=F);r(w,d);
k.appendChild(w);!D&&c&&(!P&&e&&u(w,{display:"block"}),r(w,"dy",J(w)));if(t){d=b.replace(/([^\^])-/g,"$1- ").split(" ");l=1<h.length||c||1<d.length&&!f;for(var q,g,M=[],C=J(w),K=a.rotation,I=b,Q=I.length;(l||z)&&(d.length||M.length);)a.rotation=0,q=a.getBBox(!0),g=q.width,!P&&v.forExport&&(g=v.measureSpanWidth(w.firstChild.data,a.styles)),q=g>t,void 0===n&&(n=q),z&&n?(Q/=2,""===I||!q&&.5>Q?d=[]:(I=b.substring(0,I.length+(q?-1:1)*Math.ceil(Q)),d=[I+(3<t?"\u2026":"")],w.removeChild(w.firstChild))):
q&&1!==d.length?(w.removeChild(w.firstChild),M.unshift(d.pop())):(d=M,M=[],d.length&&!f&&(w=p.createElementNS(N,"tspan"),r(w,{dy:C,x:F}),E&&r(w,"style",E),k.appendChild(w)),g>t&&(t=g)),d.length&&w.appendChild(p.createTextNode(d.join(" ").replace(/- /g,"-")));a.rotation=K}D++}}})}),n&&a.attr("title",a.textStr),d&&d.removeChild(k),l&&a.applyTextOutline&&a.applyTextOutline(l)):k.appendChild(p.createTextNode(b.replace(/&lt;/g,"\x3c").replace(/&gt;/g,"\x3e")))}},getContrast:function(a){a=f(a).rgba;return 510<
a[0]+a[1]+a[2]?"#000000":"#FFFFFF"},button:function(a,k,e,b,c,h,D,m,d){var v=this.label(a,k,e,d,null,null,null,null,"button"),n=0;v.attr(y({padding:8,r:2},c));var F,w,p,l;c=y({fill:"#f7f7f7",stroke:"#cccccc","stroke-width":1,style:{color:"#333333",cursor:"pointer",fontWeight:"normal"}},c);F=c.style;delete c.style;h=y(c,{fill:"#e6e6e6"},h);w=h.style;delete h.style;D=y(c,{fill:"#e6ebf5",style:{color:"#000000",fontWeight:"bold"}},D);p=D.style;delete D.style;m=y(c,{style:{color:"#cccccc"}},m);l=m.style;
delete m.style;H(v.element,x?"mouseover":"mouseenter",function(){3!==n&&v.setState(1)});H(v.element,x?"mouseout":"mouseleave",function(){3!==n&&v.setState(n)});v.setState=function(a){1!==a&&(v.state=n=a);v.removeClass(/highcharts-button-(normal|hover|pressed|disabled)/).addClass("highcharts-button-"+["normal","hover","pressed","disabled"][a||0]);v.attr([c,h,D,m][a||0]).css([F,w,p,l][a||0])};v.attr(c).css(t({cursor:"default"},F));return v.on("click",function(a){3!==n&&b.call(v,a)})},crispLine:function(a,
k){a[1]===a[4]&&(a[1]=a[4]=Math.round(a[1])-k%2/2);a[2]===a[5]&&(a[2]=a[5]=Math.round(a[2])+k%2/2);return a},path:function(a){var k={fill:"none"};z(a)?k.d=a:F(a)&&t(k,a);return this.createElement("path").attr(k)},circle:function(a,k,e){a=F(a)?a:{x:a,y:k,r:e};k=this.createElement("circle");k.xSetter=k.ySetter=function(a,k,e){e.setAttribute("c"+k,a)};return k.attr(a)},arc:function(a,k,e,b,c,h){F(a)&&(k=a.y,e=a.r,b=a.innerR,c=a.start,h=a.end,a=a.x);a=this.symbol("arc",a||0,k||0,e||0,e||0,{innerR:b||
0,start:c||0,end:h||0});a.r=e;return a},rect:function(a,k,e,b,c,h){c=F(a)?a.r:c;var v=this.createElement("rect");a=F(a)?a:void 0===a?{}:{x:a,y:k,width:Math.max(e,0),height:Math.max(b,0)};void 0!==h&&(a.strokeWidth=h,a=v.crisp(a));a.fill="none";c&&(a.r=c);v.rSetter=function(a,k,e){r(e,{rx:a,ry:a})};return v.attr(a)},setSize:function(a,k,e){var b=this.alignedObjects,v=b.length;this.width=a;this.height=k;for(this.boxWrapper.animate({width:a,height:k},{step:function(){this.attr({viewBox:"0 0 "+this.attr("width")+
" "+this.attr("height")})},duration:K(e,!0)?void 0:0});v--;)b[v].align()},g:function(a){var k=this.createElement("g");return a?k.attr({"class":"highcharts-"+a}):k},image:function(a,k,e,b,c){var v={preserveAspectRatio:"none"};1<arguments.length&&t(v,{x:k,y:e,width:b,height:c});v=this.createElement("image").attr(v);v.element.setAttributeNS?v.element.setAttributeNS("http://www.w3.org/1999/xlink","href",a):v.element.setAttribute("hc-svg-href",a);return v},symbol:function(a,k,e,b,c,h){var v=this,D,x=this.symbols[a],
m=q(k)&&x&&this.symbols[a](Math.round(k),Math.round(e),b,c,h),y=/^url\((.*?)\)$/,d,n;x?(D=this.path(m),D.attr("fill","none"),t(D,{symbolName:a,x:k,y:e,width:b,height:c}),h&&t(D,h)):y.test(a)&&(d=a.match(y)[1],D=this.image(d),D.imgwidth=K(S[d]&&S[d].width,h&&h.width),D.imgheight=K(S[d]&&S[d].height,h&&h.height),n=function(){D.attr({width:D.width,height:D.height})},C(["width","height"],function(a){D[a+"Setter"]=function(a,k){var e={},b=this["img"+k],v="width"===k?"translateX":"translateY";this[k]=a;
q(b)&&(this.element&&this.element.setAttribute(k,b),this.alignByTranslate||(e[v]=((this[k]||0)-b)/2,this.attr(e)))}}),q(k)&&D.attr({x:k,y:e}),D.isImg=!0,q(D.imgwidth)&&q(D.imgheight)?n():(D.attr({width:0,height:0}),l("img",{onload:function(){var a=g[v.chartIndex];0===this.width&&(u(this,{position:"absolute",top:"-999em"}),p.body.appendChild(this));S[d]={width:this.width,height:this.height};D.imgwidth=this.width;D.imgheight=this.height;D.element&&n();this.parentNode&&this.parentNode.removeChild(this);
v.imgCount--;if(!v.imgCount&&a&&a.onload)a.onload()},src:d}),this.imgCount++));return D},symbols:{circle:function(a,k,e,b){return this.arc(a+e/2,k+b/2,e/2,b/2,{start:0,end:2*Math.PI,open:!1})},square:function(a,k,e,b){return["M",a,k,"L",a+e,k,a+e,k+b,a,k+b,"Z"]},triangle:function(a,k,e,b){return["M",a+e/2,k,"L",a+e,k+b,a,k+b,"Z"]},"triangle-down":function(a,k,e,b){return["M",a,k,"L",a+e,k,a+e/2,k+b,"Z"]},diamond:function(a,k,e,b){return["M",a+e/2,k,"L",a+e,k+b/2,a+e/2,k+b,a,k+b/2,"Z"]},arc:function(a,
k,e,b,c){var v=c.start,h=c.r||e,D=c.r||b||e,x=c.end-.001;e=c.innerR;b=c.open;var m=Math.cos(v),d=Math.sin(v),y=Math.cos(x),x=Math.sin(x);c=c.end-v<Math.PI?0:1;h=["M",a+h*m,k+D*d,"A",h,D,0,c,1,a+h*y,k+D*x];q(e)&&h.push(b?"M":"L",a+e*y,k+e*x,"A",e,e,0,c,0,a+e*m,k+e*d);h.push(b?"":"Z");return h},callout:function(a,k,e,b,c){var h=Math.min(c&&c.r||0,e,b),D=h+6,v=c&&c.anchorX;c=c&&c.anchorY;var x;x=["M",a+h,k,"L",a+e-h,k,"C",a+e,k,a+e,k,a+e,k+h,"L",a+e,k+b-h,"C",a+e,k+b,a+e,k+b,a+e-h,k+b,"L",a+h,k+b,"C",
a,k+b,a,k+b,a,k+b-h,"L",a,k+h,"C",a,k,a,k,a+h,k];v&&v>e?c>k+D&&c<k+b-D?x.splice(13,3,"L",a+e,c-6,a+e+6,c,a+e,c+6,a+e,k+b-h):x.splice(13,3,"L",a+e,b/2,v,c,a+e,b/2,a+e,k+b-h):v&&0>v?c>k+D&&c<k+b-D?x.splice(33,3,"L",a,c+6,a-6,c,a,c-6,a,k+h):x.splice(33,3,"L",a,b/2,v,c,a,b/2,a,k+h):c&&c>b&&v>a+D&&v<a+e-D?x.splice(23,3,"L",v+6,k+b,v,k+b+6,v-6,k+b,a+h,k+b):c&&0>c&&v>a+D&&v<a+e-D&&x.splice(3,3,"L",v-6,k,v,k-6,v+6,k,e-h,k);return x}},clipRect:function(k,e,b,c){var h=a.uniqueKey(),D=this.createElement("clipPath").attr({id:h}).add(this.defs);
k=this.rect(k,e,b,c,0).add(D);k.id=h;k.clipPath=D;k.count=0;return k},text:function(a,k,e,b){var c=!P&&this.forExport,h={};if(b&&(this.allowHTML||!this.forExport))return this.html(a,k,e);h.x=Math.round(k||0);e&&(h.y=Math.round(e));if(a||0===a)h.text=a;a=this.createElement("text").attr(h);c&&a.css({position:"absolute"});b||(a.xSetter=function(a,k,e){var b=e.getElementsByTagName("tspan"),c,h=e.getAttribute(k),D;for(D=0;D<b.length;D++)c=b[D],c.getAttribute(k)===h&&c.setAttribute(k,a);e.setAttribute(k,
a)});return a},fontMetrics:function(a,k){a=a||k&&k.style&&k.style.fontSize||this.style&&this.style.fontSize;a=/px/.test(a)?I(a):/em/.test(a)?parseFloat(a)*(k?this.fontMetrics(null,k.parentNode).f:16):12;k=24>a?a+3:Math.round(1.2*a);return{h:k,b:Math.round(.8*k),f:a}},rotCorr:function(a,k,e){var b=a;k&&e&&(b=Math.max(b*Math.cos(k*d),4));return{x:-a/3*Math.sin(k*d),y:b}},label:function(a,e,b,c,h,D,x,m,d){var v=this,n=v.g("button"!==d&&"label"),F=n.text=v.text("",0,0,x).attr({zIndex:1}),w,p,l=0,z=3,
E=0,f,g,J,K,P,N={},I,u,r=/^url\((.*?)\)$/.test(c),M=r,S,Q,R,O;d&&n.addClass("highcharts-"+d);M=r;S=function(){return(I||0)%2/2};Q=function(){var a=F.element.style,k={};p=(void 0===f||void 0===g||P)&&q(F.textStr)&&F.getBBox();n.width=(f||p.width||0)+2*z+E;n.height=(g||p.height||0)+2*z;u=z+v.fontMetrics(a&&a.fontSize,F).b;M&&(w||(n.box=w=v.symbols[c]||r?v.symbol(c):v.rect(),w.addClass(("button"===d?"":"highcharts-label-box")+(d?" highcharts-"+d+"-box":"")),w.add(n),a=S(),k.x=a,k.y=(m?-u:0)+a),k.width=
Math.round(n.width),k.height=Math.round(n.height),w.attr(t(k,N)),N={})};R=function(){var a=E+z,k;k=m?0:u;q(f)&&p&&("center"===P||"right"===P)&&(a+={center:.5,right:1}[P]*(f-p.width));if(a!==F.x||k!==F.y)F.attr("x",a),void 0!==k&&F.attr("y",k);F.x=a;F.y=k};O=function(a,k){w?w.attr(a,k):N[a]=k};n.onAdd=function(){F.add(n);n.attr({text:a||0===a?a:"",x:e,y:b});w&&q(h)&&n.attr({anchorX:h,anchorY:D})};n.widthSetter=function(a){f=a};n.heightSetter=function(a){g=a};n["text-alignSetter"]=function(a){P=a};
n.paddingSetter=function(a){q(a)&&a!==z&&(z=n.padding=a,R())};n.paddingLeftSetter=function(a){q(a)&&a!==E&&(E=a,R())};n.alignSetter=function(a){a={left:0,center:.5,right:1}[a];a!==l&&(l=a,p&&n.attr({x:J}))};n.textSetter=function(a){void 0!==a&&F.textSetter(a);Q();R()};n["stroke-widthSetter"]=function(a,k){a&&(M=!0);I=this["stroke-width"]=a;O(k,a)};n.strokeSetter=n.fillSetter=n.rSetter=function(a,k){"fill"===k&&a&&(M=!0);O(k,a)};n.anchorXSetter=function(a,k){h=a;O(k,Math.round(a)-S()-J)};n.anchorYSetter=
function(a,k){D=a;O(k,a-K)};n.xSetter=function(a){n.x=a;l&&(a-=l*((f||p.width)+2*z));J=Math.round(a);n.attr("translateX",J)};n.ySetter=function(a){K=n.y=Math.round(a);n.attr("translateY",K)};var V=n.css;return t(n,{css:function(a){if(a){var k={};a=y(a);C(n.textProps,function(e){void 0!==a[e]&&(k[e]=a[e],delete a[e])});F.css(k)}return V.call(n,a)},getBBox:function(){return{width:p.width+2*z,height:p.height+2*z,x:p.x-z,y:p.y-z}},shadow:function(a){a&&(Q(),w&&w.shadow(a));return n},destroy:function(){k(n.element,
"mouseenter");k(n.element,"mouseleave");F&&(F=F.destroy());w&&(w=w.destroy());B.prototype.destroy.call(n);n=v=Q=R=O=null}})}};a.Renderer=A})(L);(function(a){var B=a.attr,A=a.createElement,H=a.css,G=a.defined,r=a.each,g=a.extend,f=a.isFirefox,u=a.isMS,l=a.isWebKit,q=a.pInt,d=a.SVGRenderer,b=a.win,p=a.wrap;g(a.SVGElement.prototype,{htmlCss:function(a){var b=this.element;if(b=a&&"SPAN"===b.tagName&&a.width)delete a.width,this.textWidth=b,this.updateTransform();a&&"ellipsis"===a.textOverflow&&(a.whiteSpace=
"nowrap",a.overflow="hidden");this.styles=g(this.styles,a);H(this.element,a);return this},htmlGetBBox:function(){var a=this.element;"text"===a.nodeName&&(a.style.position="absolute");return{x:a.offsetLeft,y:a.offsetTop,width:a.offsetWidth,height:a.offsetHeight}},htmlUpdateTransform:function(){if(this.added){var a=this.renderer,b=this.element,m=this.translateX||0,c=this.translateY||0,n=this.x||0,d=this.y||0,p=this.textAlign||"left",e={left:0,center:.5,right:1}[p],x=this.styles;H(b,{marginLeft:m,marginTop:c});
this.shadows&&r(this.shadows,function(a){H(a,{marginLeft:m+1,marginTop:c+1})});this.inverted&&r(b.childNodes,function(e){a.invertChild(e,b)});if("SPAN"===b.tagName){var F=this.rotation,w=q(this.textWidth),h=x&&x.whiteSpace,y=[F,p,b.innerHTML,this.textWidth,this.textAlign].join();y!==this.cTT&&(x=a.fontMetrics(b.style.fontSize).b,G(F)&&this.setSpanRotation(F,e,x),H(b,{width:"",whiteSpace:h||"nowrap"}),b.offsetWidth>w&&/[ \-]/.test(b.textContent||b.innerText)&&H(b,{width:w+"px",display:"block",whiteSpace:h||
"normal"}),this.getSpanCorrection(b.offsetWidth,x,e,F,p));H(b,{left:n+(this.xCorr||0)+"px",top:d+(this.yCorr||0)+"px"});l&&(x=b.offsetHeight);this.cTT=y}}else this.alignOnAdd=!0},setSpanRotation:function(a,d,m){var c={},n=u?"-ms-transform":l?"-webkit-transform":f?"MozTransform":b.opera?"-o-transform":"";c[n]=c.transform="rotate("+a+"deg)";c[n+(f?"Origin":"-origin")]=c.transformOrigin=100*d+"% "+m+"px";H(this.element,c)},getSpanCorrection:function(a,b,m){this.xCorr=-a*m;this.yCorr=-b}});g(d.prototype,
{html:function(a,b,m){var c=this.createElement("span"),n=c.element,d=c.renderer,l=d.isSVG,e=function(a,e){r(["opacity","visibility"],function(b){p(a,b+"Setter",function(a,b,c,x){a.call(this,b,c,x);e[c]=b})})};c.textSetter=function(a){a!==n.innerHTML&&delete this.bBox;n.innerHTML=this.textStr=a;c.htmlUpdateTransform()};l&&e(c,c.element.style);c.xSetter=c.ySetter=c.alignSetter=c.rotationSetter=function(a,e){"align"===e&&(e="textAlign");c[e]=a;c.htmlUpdateTransform()};c.attr({text:a,x:Math.round(b),
y:Math.round(m)}).css({fontFamily:this.style.fontFamily,fontSize:this.style.fontSize,position:"absolute"});n.style.whiteSpace="nowrap";c.css=c.htmlCss;l&&(c.add=function(a){var b,x=d.box.parentNode,h=[];if(this.parentGroup=a){if(b=a.div,!b){for(;a;)h.push(a),a=a.parentGroup;r(h.reverse(),function(a){var n,m=B(a.element,"class");m&&(m={className:m});b=a.div=a.div||A("div",m,{position:"absolute",left:(a.translateX||0)+"px",top:(a.translateY||0)+"px",display:a.display,opacity:a.opacity,pointerEvents:a.styles&&
a.styles.pointerEvents},b||x);n=b.style;g(a,{on:function(){c.on.apply({element:h[0].div},arguments);return a},translateXSetter:function(e,k){n.left=e+"px";a[k]=e;a.doTransform=!0},translateYSetter:function(e,k){n.top=e+"px";a[k]=e;a.doTransform=!0}});e(a,n)})}}else b=x;b.appendChild(n);c.added=!0;c.alignOnAdd&&c.htmlUpdateTransform();return c});return c}})})(L);(function(a){var B,A,H=a.createElement,G=a.css,r=a.defined,g=a.deg2rad,f=a.discardElement,u=a.doc,l=a.each,q=a.erase,d=a.extend;B=a.extendClass;
var b=a.isArray,p=a.isNumber,C=a.isObject,t=a.merge;A=a.noop;var m=a.pick,c=a.pInt,n=a.SVGElement,E=a.SVGRenderer,z=a.win;a.svg||(A={docMode8:u&&8===u.documentMode,init:function(a,b){var e=["\x3c",b,' filled\x3d"f" stroked\x3d"f"'],c=["position: ","absolute",";"],h="div"===b;("shape"===b||h)&&c.push("left:0;top:0;width:1px;height:1px;");c.push("visibility: ",h?"hidden":"visible");e.push(' style\x3d"',c.join(""),'"/\x3e');b&&(e=h||"span"===b||"img"===b?e.join(""):a.prepVML(e),this.element=H(e));this.renderer=
a},add:function(a){var e=this.renderer,b=this.element,c=e.box,h=a&&a.inverted,c=a?a.element||a:c;a&&(this.parentGroup=a);h&&e.invertChild(b,c);c.appendChild(b);this.added=!0;this.alignOnAdd&&!this.deferUpdateTransform&&this.updateTransform();if(this.onAdd)this.onAdd();this.className&&this.attr("class",this.className);return this},updateTransform:n.prototype.htmlUpdateTransform,setSpanRotation:function(){var a=this.rotation,b=Math.cos(a*g),c=Math.sin(a*g);G(this.element,{filter:a?["progid:DXImageTransform.Microsoft.Matrix(M11\x3d",
b,", M12\x3d",-c,", M21\x3d",c,", M22\x3d",b,", sizingMethod\x3d'auto expand')"].join(""):"none"})},getSpanCorrection:function(a,b,c,n,h){var e=n?Math.cos(n*g):1,x=n?Math.sin(n*g):0,d=m(this.elemHeight,this.element.offsetHeight),F;this.xCorr=0>e&&-a;this.yCorr=0>x&&-d;F=0>e*x;this.xCorr+=x*b*(F?1-c:c);this.yCorr-=e*b*(n?F?c:1-c:1);h&&"left"!==h&&(this.xCorr-=a*c*(0>e?-1:1),n&&(this.yCorr-=d*c*(0>x?-1:1)),G(this.element,{textAlign:h}))},pathToVML:function(a){for(var b=a.length,e=[];b--;)p(a[b])?e[b]=
Math.round(10*a[b])-5:"Z"===a[b]?e[b]="x":(e[b]=a[b],!a.isArc||"wa"!==a[b]&&"at"!==a[b]||(e[b+5]===e[b+7]&&(e[b+7]+=a[b+7]>a[b+5]?1:-1),e[b+6]===e[b+8]&&(e[b+8]+=a[b+8]>a[b+6]?1:-1)));return e.join(" ")||"x"},clip:function(a){var b=this,e;a?(e=a.members,q(e,b),e.push(b),b.destroyClip=function(){q(e,b)},a=a.getCSS(b)):(b.destroyClip&&b.destroyClip(),a={clip:b.docMode8?"inherit":"rect(auto)"});return b.css(a)},css:n.prototype.htmlCss,safeRemoveChild:function(a){a.parentNode&&f(a)},destroy:function(){this.destroyClip&&
this.destroyClip();return n.prototype.destroy.apply(this)},on:function(a,b){this.element["on"+a]=function(){var a=z.event;a.target=a.srcElement;b(a)};return this},cutOffPath:function(a,b){var e;a=a.split(/[ ,]/);e=a.length;if(9===e||11===e)a[e-4]=a[e-2]=c(a[e-2])-10*b;return a.join(" ")},shadow:function(a,b,n){var e=[],h,d=this.element,x=this.renderer,p,F=d.style,k,D=d.path,l,t,z,f;D&&"string"!==typeof D.value&&(D="x");t=D;if(a){z=m(a.width,3);f=(a.opacity||.15)/z;for(h=1;3>=h;h++)l=2*z+1-2*h,n&&
(t=this.cutOffPath(D.value,l+.5)),k=['\x3cshape isShadow\x3d"true" strokeweight\x3d"',l,'" filled\x3d"false" path\x3d"',t,'" coordsize\x3d"10 10" style\x3d"',d.style.cssText,'" /\x3e'],p=H(x.prepVML(k),null,{left:c(F.left)+m(a.offsetX,1),top:c(F.top)+m(a.offsetY,1)}),n&&(p.cutOff=l+1),k=['\x3cstroke color\x3d"',a.color||"#000000",'" opacity\x3d"',f*h,'"/\x3e'],H(x.prepVML(k),null,null,p),b?b.element.appendChild(p):d.parentNode.insertBefore(p,d),e.push(p);this.shadows=e}return this},updateShadows:A,
setAttr:function(a,b){this.docMode8?this.element[a]=b:this.element.setAttribute(a,b)},classSetter:function(a){(this.added?this.element:this).className=a},dashstyleSetter:function(a,b,c){(c.getElementsByTagName("stroke")[0]||H(this.renderer.prepVML(["\x3cstroke/\x3e"]),null,null,c))[b]=a||"solid";this[b]=a},dSetter:function(a,b,c){var e=this.shadows;a=a||[];this.d=a.join&&a.join(" ");c.path=a=this.pathToVML(a);if(e)for(c=e.length;c--;)e[c].path=e[c].cutOff?this.cutOffPath(a,e[c].cutOff):a;this.setAttr(b,
a)},fillSetter:function(a,b,c){var e=c.nodeName;"SPAN"===e?c.style.color=a:"IMG"!==e&&(c.filled="none"!==a,this.setAttr("fillcolor",this.renderer.color(a,c,b,this)))},"fill-opacitySetter":function(a,b,c){H(this.renderer.prepVML(["\x3c",b.split("-")[0],' opacity\x3d"',a,'"/\x3e']),null,null,c)},opacitySetter:A,rotationSetter:function(a,b,c){c=c.style;this[b]=c[b]=a;c.left=-Math.round(Math.sin(a*g)+1)+"px";c.top=Math.round(Math.cos(a*g))+"px"},strokeSetter:function(a,b,c){this.setAttr("strokecolor",
this.renderer.color(a,c,b,this))},"stroke-widthSetter":function(a,b,c){c.stroked=!!a;this[b]=a;p(a)&&(a+="px");this.setAttr("strokeweight",a)},titleSetter:function(a,b){this.setAttr(b,a)},visibilitySetter:function(a,b,c){"inherit"===a&&(a="visible");this.shadows&&l(this.shadows,function(c){c.style[b]=a});"DIV"===c.nodeName&&(a="hidden"===a?"-999em":0,this.docMode8||(c.style[b]=a?"visible":"hidden"),b="top");c.style[b]=a},xSetter:function(a,b,c){this[b]=a;"x"===b?b="left":"y"===b&&(b="top");this.updateClipping?
(this[b]=a,this.updateClipping()):c.style[b]=a},zIndexSetter:function(a,b,c){c.style[b]=a}},A["stroke-opacitySetter"]=A["fill-opacitySetter"],a.VMLElement=A=B(n,A),A.prototype.ySetter=A.prototype.widthSetter=A.prototype.heightSetter=A.prototype.xSetter,A={Element:A,isIE8:-1<z.navigator.userAgent.indexOf("MSIE 8.0"),init:function(a,b,c){var e,h;this.alignedObjects=[];e=this.createElement("div").css({position:"relative"});h=e.element;a.appendChild(e.element);this.isVML=!0;this.box=h;this.boxWrapper=
e;this.gradients={};this.cache={};this.cacheKeys=[];this.imgCount=0;this.setSize(b,c,!1);if(!u.namespaces.hcv){u.namespaces.add("hcv","urn:schemas-microsoft-com:vml");try{u.createStyleSheet().cssText="hcv\\:fill, hcv\\:path, hcv\\:shape, hcv\\:stroke{ behavior:url(#default#VML); display: inline-block; } "}catch(y){u.styleSheets[0].cssText+="hcv\\:fill, hcv\\:path, hcv\\:shape, hcv\\:stroke{ behavior:url(#default#VML); display: inline-block; } "}}},isHidden:function(){return!this.box.offsetWidth},
clipRect:function(a,b,c,n){var e=this.createElement(),m=C(a);return d(e,{members:[],count:0,left:(m?a.x:a)+1,top:(m?a.y:b)+1,width:(m?a.width:c)-1,height:(m?a.height:n)-1,getCSS:function(a){var b=a.element,c=b.nodeName,k=a.inverted,e=this.top-("shape"===c?b.offsetTop:0),h=this.left,b=h+this.width,n=e+this.height,e={clip:"rect("+Math.round(k?h:e)+"px,"+Math.round(k?n:b)+"px,"+Math.round(k?b:n)+"px,"+Math.round(k?e:h)+"px)"};!k&&a.docMode8&&"DIV"===c&&d(e,{width:b+"px",height:n+"px"});return e},updateClipping:function(){l(e.members,
function(a){a.element&&a.css(e.getCSS(a))})}})},color:function(b,c,n,m){var e=this,d,x=/^rgba/,p,t,k="none";b&&b.linearGradient?t="gradient":b&&b.radialGradient&&(t="pattern");if(t){var D,w,z=b.linearGradient||b.radialGradient,f,E,v,q,g,F="";b=b.stops;var C,u=[],r=function(){p=['\x3cfill colors\x3d"'+u.join(",")+'" opacity\x3d"',v,'" o:opacity2\x3d"',E,'" type\x3d"',t,'" ',F,'focus\x3d"100%" method\x3d"any" /\x3e'];H(e.prepVML(p),null,null,c)};f=b[0];C=b[b.length-1];0<f[0]&&b.unshift([0,f[1]]);1>
C[0]&&b.push([1,C[1]]);l(b,function(k,b){x.test(k[1])?(d=a.color(k[1]),D=d.get("rgb"),w=d.get("a")):(D=k[1],w=1);u.push(100*k[0]+"% "+D);b?(v=w,q=D):(E=w,g=D)});if("fill"===n)if("gradient"===t)n=z.x1||z[0]||0,b=z.y1||z[1]||0,f=z.x2||z[2]||0,z=z.y2||z[3]||0,F='angle\x3d"'+(90-180*Math.atan((z-b)/(f-n))/Math.PI)+'"',r();else{var k=z.r,A=2*k,B=2*k,G=z.cx,U=z.cy,L=c.radialReference,T,k=function(){L&&(T=m.getBBox(),G+=(L[0]-T.x)/T.width-.5,U+=(L[1]-T.y)/T.height-.5,A*=L[2]/T.width,B*=L[2]/T.height);F=
'src\x3d"'+a.getOptions().global.VMLRadialGradientURL+'" size\x3d"'+A+","+B+'" origin\x3d"0.5,0.5" position\x3d"'+G+","+U+'" color2\x3d"'+g+'" ';r()};m.added?k():m.onAdd=k;k=q}else k=D}else x.test(b)&&"IMG"!==c.tagName?(d=a.color(b),m[n+"-opacitySetter"](d.get("a"),n,c),k=d.get("rgb")):(k=c.getElementsByTagName(n),k.length&&(k[0].opacity=1,k[0].type="solid"),k=b);return k},prepVML:function(a){var b=this.isIE8;a=a.join("");b?(a=a.replace("/\x3e",' xmlns\x3d"urn:schemas-microsoft-com:vml" /\x3e'),a=
-1===a.indexOf('style\x3d"')?a.replace("/\x3e",' style\x3d"display:inline-block;behavior:url(#default#VML);" /\x3e'):a.replace('style\x3d"','style\x3d"display:inline-block;behavior:url(#default#VML);')):a=a.replace("\x3c","\x3chcv:");return a},text:E.prototype.html,path:function(a){var c={coordsize:"10 10"};b(a)?c.d=a:C(a)&&d(c,a);return this.createElement("shape").attr(c)},circle:function(a,b,c){var e=this.symbol("circle");C(a)&&(c=a.r,b=a.y,a=a.x);e.isCircle=!0;e.r=c;return e.attr({x:a,y:b})},g:function(a){var b;
a&&(b={className:"highcharts-"+a,"class":"highcharts-"+a});return this.createElement("div").attr(b)},image:function(a,b,c,n,h){var e=this.createElement("img").attr({src:a});1<arguments.length&&e.attr({x:b,y:c,width:n,height:h});return e},createElement:function(a){return"rect"===a?this.symbol(a):E.prototype.createElement.call(this,a)},invertChild:function(a,b){var e=this;b=b.style;var n="IMG"===a.tagName&&a.style;G(a,{flip:"x",left:c(b.width)-(n?c(n.top):1),top:c(b.height)-(n?c(n.left):1),rotation:-90});
l(a.childNodes,function(b){e.invertChild(b,a)})},symbols:{arc:function(a,b,c,n,h){var e=h.start,m=h.end,d=h.r||c||n;c=h.innerR;n=Math.cos(e);var p=Math.sin(e),k=Math.cos(m),D=Math.sin(m);if(0===m-e)return["x"];e=["wa",a-d,b-d,a+d,b+d,a+d*n,b+d*p,a+d*k,b+d*D];h.open&&!c&&e.push("e","M",a,b);e.push("at",a-c,b-c,a+c,b+c,a+c*k,b+c*D,a+c*n,b+c*p,"x","e");e.isArc=!0;return e},circle:function(a,b,c,n,h){h&&r(h.r)&&(c=n=2*h.r);h&&h.isCircle&&(a-=c/2,b-=n/2);return["wa",a,b,a+c,b+n,a+c,b+n/2,a+c,b+n/2,"e"]},
rect:function(a,b,c,n,h){return E.prototype.symbols[r(h)&&h.r?"callout":"square"].call(0,a,b,c,n,h)}}},a.VMLRenderer=B=function(){this.init.apply(this,arguments)},B.prototype=t(E.prototype,A),a.Renderer=B);E.prototype.measureSpanWidth=function(a,b){var c=u.createElement("span");a=u.createTextNode(a);c.appendChild(a);G(c,b);this.box.appendChild(c);b=c.offsetWidth;f(c);return b}})(L);(function(a){function B(){var l=a.defaultOptions.global,f=u.moment;if(l.timezone){if(f)return function(a){return-f.tz(a,
l.timezone).utcOffset()};a.error(25)}return l.useUTC&&l.getTimezoneOffset}function A(){var l=a.defaultOptions.global,q,d=l.useUTC,b=d?"getUTC":"get",p=d?"setUTC":"set";a.Date=q=l.Date||u.Date;q.hcTimezoneOffset=d&&l.timezoneOffset;q.hcGetTimezoneOffset=B();q.hcMakeTime=function(a,b,m,c,n,p){var l;d?(l=q.UTC.apply(0,arguments),l+=r(l)):l=(new q(a,b,f(m,1),f(c,0),f(n,0),f(p,0))).getTime();return l};G("Minutes Hours Day Date Month FullYear".split(" "),function(a){q["hcGet"+a]=b+a});G("Milliseconds Seconds Minutes Hours Date Month FullYear".split(" "),
function(a){q["hcSet"+a]=p+a})}var H=a.color,G=a.each,r=a.getTZOffset,g=a.merge,f=a.pick,u=a.win;a.defaultOptions={colors:"#7cb5ec #434348 #90ed7d #f7a35c #8085e9 #f15c80 #e4d354 #2b908f #f45b5b #91e8e1".split(" "),symbols:["circle","diamond","square","triangle","triangle-down"],lang:{loading:"Loading...",months:"January February March April May June July August September October November December".split(" "),shortMonths:"Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" "),weekdays:"Sunday Monday Tuesday Wednesday Thursday Friday Saturday".split(" "),
decimalPoint:".",numericSymbols:"kMGTPE".split(""),resetZoom:"Reset zoom",resetZoomTitle:"Reset zoom level 1:1",thousandsSep:" "},global:{useUTC:!0,VMLRadialGradientURL:"http://code.highcharts.com/5.0.7/gfx/vml-radial-gradient.png"},chart:{borderRadius:0,defaultSeriesType:"line",ignoreHiddenSeries:!0,spacing:[10,10,15,10],resetZoomButton:{theme:{zIndex:20},position:{align:"right",x:-10,y:10}},width:null,height:null,borderColor:"#335cad",backgroundColor:"#ffffff",plotBorderColor:"#cccccc"},title:{text:"Chart title",
align:"center",margin:15,widthAdjust:-44},subtitle:{text:"",align:"center",widthAdjust:-44},plotOptions:{},labels:{style:{position:"absolute",color:"#333333"}},legend:{enabled:!0,align:"center",layout:"horizontal",labelFormatter:function(){return this.name},borderColor:"#999999",borderRadius:0,navigation:{activeColor:"#003399",inactiveColor:"#cccccc"},itemStyle:{color:"#333333",fontSize:"12px",fontWeight:"bold"},itemHoverStyle:{color:"#000000"},itemHiddenStyle:{color:"#cccccc"},shadow:!1,itemCheckboxStyle:{position:"absolute",
width:"13px",height:"13px"},squareSymbol:!0,symbolPadding:5,verticalAlign:"bottom",x:0,y:0,title:{style:{fontWeight:"bold"}}},loading:{labelStyle:{fontWeight:"bold",position:"relative",top:"45%"},style:{position:"absolute",backgroundColor:"#ffffff",opacity:.5,textAlign:"center"}},tooltip:{enabled:!0,animation:a.svg,borderRadius:3,dateTimeLabelFormats:{millisecond:"%A, %b %e, %H:%M:%S.%L",second:"%A, %b %e, %H:%M:%S",minute:"%A, %b %e, %H:%M",hour:"%A, %b %e, %H:%M",day:"%A, %b %e, %Y",week:"Week from %A, %b %e, %Y",
month:"%B %Y",year:"%Y"},footerFormat:"",padding:8,snap:a.isTouchDevice?25:10,backgroundColor:H("#f7f7f7").setOpacity(.85).get(),borderWidth:1,headerFormat:'\x3cspan style\x3d"font-size: 10px"\x3e{point.key}\x3c/span\x3e\x3cbr/\x3e',pointFormat:'\x3cspan style\x3d"color:{point.color}"\x3e\u25cf\x3c/span\x3e {series.name}: \x3cb\x3e{point.y}\x3c/b\x3e\x3cbr/\x3e',shadow:!0,style:{color:"#333333",cursor:"default",fontSize:"12px",pointerEvents:"none",whiteSpace:"nowrap"}},credits:{enabled:!0,href:"http://www.highcharts.com",
position:{align:"right",x:-10,verticalAlign:"bottom",y:-5},style:{cursor:"pointer",color:"#999999",fontSize:"9px"},text:"Highcharts.com"}};a.setOptions=function(l){a.defaultOptions=g(!0,a.defaultOptions,l);A();return a.defaultOptions};a.getOptions=function(){return a.defaultOptions};a.defaultPlotOptions=a.defaultOptions.plotOptions;A()})(L);(function(a){var B=a.arrayMax,A=a.arrayMin,H=a.defined,G=a.destroyObjectProperties,r=a.each,g=a.erase,f=a.merge,u=a.pick;a.PlotLineOrBand=function(a,f){this.axis=
a;f&&(this.options=f,this.id=f.id)};a.PlotLineOrBand.prototype={render:function(){var a=this,q=a.axis,d=q.horiz,b=a.options,p=b.label,g=a.label,t=b.to,m=b.from,c=b.value,n=H(m)&&H(t),E=H(c),z=a.svgElem,e=!z,x=[],F,w=b.color,h=u(b.zIndex,0),y=b.events,x={"class":"highcharts-plot-"+(n?"band ":"line ")+(b.className||"")},J={},K=q.chart.renderer,I=n?"bands":"lines",k=q.log2lin;q.isLog&&(m=k(m),t=k(t),c=k(c));E?(x={stroke:w,"stroke-width":b.width},b.dashStyle&&(x.dashstyle=b.dashStyle)):n&&(w&&(x.fill=
w),b.borderWidth&&(x.stroke=b.borderColor,x["stroke-width"]=b.borderWidth));J.zIndex=h;I+="-"+h;(w=q[I])||(q[I]=w=K.g("plot-"+I).attr(J).add());e&&(a.svgElem=z=K.path().attr(x).add(w));if(E)x=q.getPlotLinePath(c,z.strokeWidth());else if(n)x=q.getPlotBandPath(m,t,b);else return;if(e&&x&&x.length){if(z.attr({d:x}),y)for(F in b=function(b){z.on(b,function(k){y[b].apply(a,[k])})},y)b(F)}else z&&(x?(z.show(),z.animate({d:x})):(z.hide(),g&&(a.label=g=g.destroy())));p&&H(p.text)&&x&&x.length&&0<q.width&&
0<q.height&&!x.flat?(p=f({align:d&&n&&"center",x:d?!n&&4:10,verticalAlign:!d&&n&&"middle",y:d?n?16:10:n?6:-4,rotation:d&&!n&&90},p),this.renderLabel(p,x,n,h)):g&&g.hide();return a},renderLabel:function(a,f,d,b){var p=this.label,l=this.axis.chart.renderer;p||(p={align:a.textAlign||a.align,rotation:a.rotation,"class":"highcharts-plot-"+(d?"band":"line")+"-label "+(a.className||"")},p.zIndex=b,this.label=p=l.text(a.text,0,0,a.useHTML).attr(p).add(),p.css(a.style));b=[f[1],f[4],d?f[6]:f[1]];f=[f[2],f[5],
d?f[7]:f[2]];d=A(b);l=A(f);p.align(a,!1,{x:d,y:l,width:B(b)-d,height:B(f)-l});p.show()},destroy:function(){g(this.axis.plotLinesAndBands,this);delete this.axis;G(this)}};a.AxisPlotLineOrBandExtension={getPlotBandPath:function(a,f){f=this.getPlotLinePath(f,null,null,!0);(a=this.getPlotLinePath(a,null,null,!0))&&f?(a.flat=a.toString()===f.toString(),a.push(f[4],f[5],f[1],f[2],"z")):a=null;return a},addPlotBand:function(a){return this.addPlotBandOrLine(a,"plotBands")},addPlotLine:function(a){return this.addPlotBandOrLine(a,
"plotLines")},addPlotBandOrLine:function(f,g){var d=(new a.PlotLineOrBand(this,f)).render(),b=this.userOptions;d&&(g&&(b[g]=b[g]||[],b[g].push(f)),this.plotLinesAndBands.push(d));return d},removePlotBandOrLine:function(a){for(var f=this.plotLinesAndBands,d=this.options,b=this.userOptions,p=f.length;p--;)f[p].id===a&&f[p].destroy();r([d.plotLines||[],b.plotLines||[],d.plotBands||[],b.plotBands||[]],function(b){for(p=b.length;p--;)b[p].id===a&&g(b,b[p])})}}})(L);(function(a){var B=a.correctFloat,A=
a.defined,H=a.destroyObjectProperties,G=a.isNumber,r=a.merge,g=a.pick,f=a.deg2rad;a.Tick=function(a,f,g,d){this.axis=a;this.pos=f;this.type=g||"";this.isNew=!0;g||d||this.addLabel()};a.Tick.prototype={addLabel:function(){var a=this.axis,f=a.options,q=a.chart,d=a.categories,b=a.names,p=this.pos,C=f.labels,t=a.tickPositions,m=p===t[0],c=p===t[t.length-1],b=d?g(d[p],b[p],p):p,d=this.label,t=t.info,n;a.isDatetimeAxis&&t&&(n=f.dateTimeLabelFormats[t.higherRanks[p]||t.unitName]);this.isFirst=m;this.isLast=
c;f=a.labelFormatter.call({axis:a,chart:q,isFirst:m,isLast:c,dateTimeLabelFormat:n,value:a.isLog?B(a.lin2log(b)):b});A(d)?d&&d.attr({text:f}):(this.labelLength=(this.label=d=A(f)&&C.enabled?q.renderer.text(f,0,0,C.useHTML).css(r(C.style)).add(a.labelGroup):null)&&d.getBBox().width,this.rotation=0)},getLabelSize:function(){return this.label?this.label.getBBox()[this.axis.horiz?"height":"width"]:0},handleOverflow:function(a){var l=this.axis,q=a.x,d=l.chart.chartWidth,b=l.chart.spacing,p=g(l.labelLeft,
Math.min(l.pos,b[3])),b=g(l.labelRight,Math.max(l.pos+l.len,d-b[1])),C=this.label,t=this.rotation,m={left:0,center:.5,right:1}[l.labelAlign],c=C.getBBox().width,n=l.getSlotWidth(),E=n,z=1,e,x={};if(t)0>t&&q-m*c<p?e=Math.round(q/Math.cos(t*f)-p):0<t&&q+m*c>b&&(e=Math.round((d-q)/Math.cos(t*f)));else if(d=q+(1-m)*c,q-m*c<p?E=a.x+E*(1-m)-p:d>b&&(E=b-a.x+E*m,z=-1),E=Math.min(n,E),E<n&&"center"===l.labelAlign&&(a.x+=z*(n-E-m*(n-Math.min(c,E)))),c>E||l.autoRotation&&(C.styles||{}).width)e=E;e&&(x.width=
e,(l.options.labels.style||{}).textOverflow||(x.textOverflow="ellipsis"),C.css(x))},getPosition:function(a,f,g,d){var b=this.axis,p=b.chart,l=d&&p.oldChartHeight||p.chartHeight;return{x:a?b.translate(f+g,null,null,d)+b.transB:b.left+b.offset+(b.opposite?(d&&p.oldChartWidth||p.chartWidth)-b.right-b.left:0),y:a?l-b.bottom+b.offset-(b.opposite?b.height:0):l-b.translate(f+g,null,null,d)-b.transB}},getLabelPosition:function(a,g,q,d,b,p,C,t){var m=this.axis,c=m.transA,n=m.reversed,E=m.staggerLines,z=m.tickRotCorr||
{x:0,y:0},e=b.y;A(e)||(e=0===m.side?q.rotation?-8:-q.getBBox().height:2===m.side?z.y+8:Math.cos(q.rotation*f)*(z.y-q.getBBox(!1,0).height/2));a=a+b.x+z.x-(p&&d?p*c*(n?-1:1):0);g=g+e-(p&&!d?p*c*(n?1:-1):0);E&&(q=C/(t||1)%E,m.opposite&&(q=E-q-1),g+=m.labelOffset/E*q);return{x:a,y:Math.round(g)}},getMarkPath:function(a,f,g,d,b,p){return p.crispLine(["M",a,f,"L",a+(b?0:-g),f+(b?g:0)],d)},render:function(a,f,q){var d=this.axis,b=d.options,p=d.chart.renderer,l=d.horiz,t=this.type,m=this.label,c=this.pos,
n=b.labels,E=this.gridLine,z=t?t+"Tick":"tick",e=d.tickSize(z),x=this.mark,F=!x,w=n.step,h={},y=!0,J=d.tickmarkOffset,K=this.getPosition(l,c,J,f),I=K.x,K=K.y,k=l&&I===d.pos+d.len||!l&&K===d.pos?-1:1,D=t?t+"Grid":"grid",P=b[D+"LineWidth"],N=b[D+"LineColor"],r=b[D+"LineDashStyle"],D=g(b[z+"Width"],!t&&d.isXAxis?1:0),z=b[z+"Color"];q=g(q,1);this.isActive=!0;E||(h.stroke=N,h["stroke-width"]=P,r&&(h.dashstyle=r),t||(h.zIndex=1),f&&(h.opacity=0),this.gridLine=E=p.path().attr(h).addClass("highcharts-"+(t?
t+"-":"")+"grid-line").add(d.gridGroup));if(!f&&E&&(c=d.getPlotLinePath(c+J,E.strokeWidth()*k,f,!0)))E[this.isNew?"attr":"animate"]({d:c,opacity:q});e&&(d.opposite&&(e[0]=-e[0]),F&&(this.mark=x=p.path().addClass("highcharts-"+(t?t+"-":"")+"tick").add(d.axisGroup),x.attr({stroke:z,"stroke-width":D})),x[F?"attr":"animate"]({d:this.getMarkPath(I,K,e[0],x.strokeWidth()*k,l,p),opacity:q}));m&&G(I)&&(m.xy=K=this.getLabelPosition(I,K,m,l,n,J,a,w),this.isFirst&&!this.isLast&&!g(b.showFirstLabel,1)||this.isLast&&
!this.isFirst&&!g(b.showLastLabel,1)?y=!1:!l||d.isRadial||n.step||n.rotation||f||0===q||this.handleOverflow(K),w&&a%w&&(y=!1),y&&G(K.y)?(K.opacity=q,m[this.isNew?"attr":"animate"](K)):m.attr("y",-9999),this.isNew=!1)},destroy:function(){H(this,this.axis)}}})(L);(function(a){var B=a.addEvent,A=a.animObject,H=a.arrayMax,G=a.arrayMin,r=a.AxisPlotLineOrBandExtension,g=a.color,f=a.correctFloat,u=a.defaultOptions,l=a.defined,q=a.deg2rad,d=a.destroyObjectProperties,b=a.each,p=a.extend,C=a.fireEvent,t=a.format,
m=a.getMagnitude,c=a.grep,n=a.inArray,E=a.isArray,z=a.isNumber,e=a.isString,x=a.merge,F=a.normalizeTickInterval,w=a.pick,h=a.PlotLineOrBand,y=a.removeEvent,J=a.splat,K=a.syncTimeout,I=a.Tick;a.Axis=function(){this.init.apply(this,arguments)};a.Axis.prototype={defaultOptions:{dateTimeLabelFormats:{millisecond:"%H:%M:%S.%L",second:"%H:%M:%S",minute:"%H:%M",hour:"%H:%M",day:"%e. %b",week:"%e. %b",month:"%b '%y",year:"%Y"},endOnTick:!1,labels:{enabled:!0,style:{color:"#666666",cursor:"default",fontSize:"11px"},
x:0},minPadding:.01,maxPadding:.01,minorTickLength:2,minorTickPosition:"outside",startOfWeek:1,startOnTick:!1,tickLength:10,tickmarkPlacement:"between",tickPixelInterval:100,tickPosition:"outside",title:{align:"middle",style:{color:"#666666"}},type:"linear",minorGridLineColor:"#f2f2f2",minorGridLineWidth:1,minorTickColor:"#999999",lineColor:"#ccd6eb",lineWidth:1,gridLineColor:"#e6e6e6",tickColor:"#ccd6eb"},defaultYAxisOptions:{endOnTick:!0,tickPixelInterval:72,showLastLabel:!0,labels:{x:-8},maxPadding:.05,
minPadding:.05,startOnTick:!0,title:{rotation:270,text:"Values"},stackLabels:{enabled:!1,formatter:function(){return a.numberFormat(this.total,-1)},style:{fontSize:"11px",fontWeight:"bold",color:"#000000",textOutline:"1px contrast"}},gridLineWidth:1,lineWidth:0},defaultLeftAxisOptions:{labels:{x:-15},title:{rotation:270}},defaultRightAxisOptions:{labels:{x:15},title:{rotation:90}},defaultBottomAxisOptions:{labels:{autoRotation:[-45],x:0},title:{rotation:0}},defaultTopAxisOptions:{labels:{autoRotation:[-45],
x:0},title:{rotation:0}},init:function(a,b){var k=b.isX;this.chart=a;this.horiz=a.inverted?!k:k;this.isXAxis=k;this.coll=this.coll||(k?"xAxis":"yAxis");this.opposite=b.opposite;this.side=b.side||(this.horiz?this.opposite?0:2:this.opposite?1:3);this.setOptions(b);var c=this.options,e=c.type;this.labelFormatter=c.labels.formatter||this.defaultLabelFormatter;this.userOptions=b;this.minPixelPadding=0;this.reversed=c.reversed;this.visible=!1!==c.visible;this.zoomEnabled=!1!==c.zoomEnabled;this.hasNames=
"category"===e||!0===c.categories;this.categories=c.categories||this.hasNames;this.names=this.names||[];this.isLog="logarithmic"===e;this.isDatetimeAxis="datetime"===e;this.isLinked=l(c.linkedTo);this.ticks={};this.labelEdge=[];this.minorTicks={};this.plotLinesAndBands=[];this.alternateBands={};this.len=0;this.minRange=this.userMinRange=c.minRange||c.maxZoom;this.range=c.range;this.offset=c.offset||0;this.stacks={};this.oldStacks={};this.stacksTouched=0;this.min=this.max=null;this.crosshair=w(c.crosshair,
J(a.options.tooltip.crosshairs)[k?0:1],!1);var h;b=this.options.events;-1===n(this,a.axes)&&(k?a.axes.splice(a.xAxis.length,0,this):a.axes.push(this),a[this.coll].push(this));this.series=this.series||[];a.inverted&&k&&void 0===this.reversed&&(this.reversed=!0);this.removePlotLine=this.removePlotBand=this.removePlotBandOrLine;for(h in b)B(this,h,b[h]);this.isLog&&(this.val2lin=this.log2lin,this.lin2val=this.lin2log)},setOptions:function(a){this.options=x(this.defaultOptions,"yAxis"===this.coll&&this.defaultYAxisOptions,
[this.defaultTopAxisOptions,this.defaultRightAxisOptions,this.defaultBottomAxisOptions,this.defaultLeftAxisOptions][this.side],x(u[this.coll],a))},defaultLabelFormatter:function(){var b=this.axis,c=this.value,e=b.categories,h=this.dateTimeLabelFormat,n=u.lang,d=n.numericSymbols,n=n.numericSymbolMagnitude||1E3,v=d&&d.length,m,f=b.options.labels.format,b=b.isLog?c:b.tickInterval;if(f)m=t(f,this);else if(e)m=c;else if(h)m=a.dateFormat(h,c);else if(v&&1E3<=b)for(;v--&&void 0===m;)e=Math.pow(n,v+1),b>=
e&&0===10*c%e&&null!==d[v]&&0!==c&&(m=a.numberFormat(c/e,-1)+d[v]);void 0===m&&(m=1E4<=Math.abs(c)?a.numberFormat(c,-1):a.numberFormat(c,-1,void 0,""));return m},getSeriesExtremes:function(){var a=this,e=a.chart;a.hasVisibleSeries=!1;a.dataMin=a.dataMax=a.threshold=null;a.softThreshold=!a.isXAxis;a.buildStacks&&a.buildStacks();b(a.series,function(b){if(b.visible||!e.options.chart.ignoreHiddenSeries){var k=b.options,h=k.threshold,D;a.hasVisibleSeries=!0;a.isLog&&0>=h&&(h=null);if(a.isXAxis)k=b.xData,
k.length&&(b=G(k),z(b)||b instanceof Date||(k=c(k,function(a){return z(a)}),b=G(k)),a.dataMin=Math.min(w(a.dataMin,k[0]),b),a.dataMax=Math.max(w(a.dataMax,k[0]),H(k)));else if(b.getExtremes(),D=b.dataMax,b=b.dataMin,l(b)&&l(D)&&(a.dataMin=Math.min(w(a.dataMin,b),b),a.dataMax=Math.max(w(a.dataMax,D),D)),l(h)&&(a.threshold=h),!k.softThreshold||a.isLog)a.softThreshold=!1}})},translate:function(a,b,c,e,h,n){var k=this.linkedParent||this,D=1,m=0,d=e?k.oldTransA:k.transA;e=e?k.oldMin:k.min;var f=k.minPixelPadding;
h=(k.isOrdinal||k.isBroken||k.isLog&&h)&&k.lin2val;d||(d=k.transA);c&&(D*=-1,m=k.len);k.reversed&&(D*=-1,m-=D*(k.sector||k.len));b?(a=(a*D+m-f)/d+e,h&&(a=k.lin2val(a))):(h&&(a=k.val2lin(a)),a=D*(a-e)*d+m+D*f+(z(n)?d*n:0));return a},toPixels:function(a,b){return this.translate(a,!1,!this.horiz,null,!0)+(b?0:this.pos)},toValue:function(a,b){return this.translate(a-(b?0:this.pos),!0,!this.horiz,null,!0)},getPlotLinePath:function(a,b,c,e,h){var k=this.chart,D=this.left,n=this.top,m,d,f=c&&k.oldChartHeight||
k.chartHeight,p=c&&k.oldChartWidth||k.chartWidth,y;m=this.transB;var t=function(a,b,k){if(a<b||a>k)e?a=Math.min(Math.max(b,a),k):y=!0;return a};h=w(h,this.translate(a,null,null,c));a=c=Math.round(h+m);m=d=Math.round(f-h-m);z(h)?this.horiz?(m=n,d=f-this.bottom,a=c=t(a,D,D+this.width)):(a=D,c=p-this.right,m=d=t(m,n,n+this.height)):y=!0;return y&&!e?null:k.renderer.crispLine(["M",a,m,"L",c,d],b||1)},getLinearTickPositions:function(a,b,c){var k,e=f(Math.floor(b/a)*a),h=f(Math.ceil(c/a)*a),D=[];if(b===
c&&z(b))return[b];for(b=e;b<=h;){D.push(b);b=f(b+a);if(b===k)break;k=b}return D},getMinorTickPositions:function(){var a=this.options,b=this.tickPositions,c=this.minorTickInterval,e=[],h,n=this.pointRangePadding||0;h=this.min-n;var n=this.max+n,m=n-h;if(m&&m/c<this.len/3)if(this.isLog)for(n=b.length,h=1;h<n;h++)e=e.concat(this.getLogTickPositions(c,b[h-1],b[h],!0));else if(this.isDatetimeAxis&&"auto"===a.minorTickInterval)e=e.concat(this.getTimeTicks(this.normalizeTimeTickInterval(c),h,n,a.startOfWeek));
else for(b=h+(b[0]-h)%c;b<=n&&b!==e[0];b+=c)e.push(b);0!==e.length&&this.trimTicks(e,a.startOnTick,a.endOnTick);return e},adjustForMinRange:function(){var a=this.options,c=this.min,e=this.max,h,n=this.dataMax-this.dataMin>=this.minRange,m,v,d,f,p,y;this.isXAxis&&void 0===this.minRange&&!this.isLog&&(l(a.min)||l(a.max)?this.minRange=null:(b(this.series,function(a){f=a.xData;for(v=p=a.xIncrement?1:f.length-1;0<v;v--)if(d=f[v]-f[v-1],void 0===m||d<m)m=d}),this.minRange=Math.min(5*m,this.dataMax-this.dataMin)));
e-c<this.minRange&&(y=this.minRange,h=(y-e+c)/2,h=[c-h,w(a.min,c-h)],n&&(h[2]=this.isLog?this.log2lin(this.dataMin):this.dataMin),c=H(h),e=[c+y,w(a.max,c+y)],n&&(e[2]=this.isLog?this.log2lin(this.dataMax):this.dataMax),e=G(e),e-c<y&&(h[0]=e-y,h[1]=w(a.min,e-y),c=H(h)));this.min=c;this.max=e},getClosest:function(){var a;this.categories?a=1:b(this.series,function(b){var k=b.closestPointRange,c=b.visible||!b.chart.options.chart.ignoreHiddenSeries;!b.noSharedTooltip&&l(k)&&c&&(a=l(a)?Math.min(a,k):k)});
return a},nameToX:function(a){var b=E(this.categories),k=b?this.categories:this.names,c=a.options.x,e;a.series.requireSorting=!1;l(c)||(c=!1===this.options.uniqueNames?a.series.autoIncrement():n(a.name,k));-1===c?b||(e=k.length):e=c;this.names[e]=a.name;return e},updateNames:function(){var a=this;0<this.names.length&&(this.names.length=0,this.minRange=void 0,b(this.series||[],function(k){k.xIncrement=null;if(!k.points||k.isDirtyData)k.processData(),k.generatePoints();b(k.points,function(b,c){var e;
b.options&&(e=a.nameToX(b),e!==b.x&&(b.x=e,k.xData[c]=e))})}))},setAxisTranslation:function(a){var k=this,c=k.max-k.min,h=k.axisPointRange||0,n,m=0,d=0,f=k.linkedParent,y=!!k.categories,p=k.transA,t=k.isXAxis;if(t||y||h)n=k.getClosest(),f?(m=f.minPointOffset,d=f.pointRangePadding):b(k.series,function(a){var b=y?1:t?w(a.options.pointRange,n,0):k.axisPointRange||0;a=a.options.pointPlacement;h=Math.max(h,b);k.single||(m=Math.max(m,e(a)?0:b/2),d=Math.max(d,"on"===a?0:b))}),f=k.ordinalSlope&&n?k.ordinalSlope/
n:1,k.minPointOffset=m*=f,k.pointRangePadding=d*=f,k.pointRange=Math.min(h,c),t&&(k.closestPointRange=n);a&&(k.oldTransA=p);k.translationSlope=k.transA=p=k.len/(c+d||1);k.transB=k.horiz?k.left:k.bottom;k.minPixelPadding=p*m},minFromRange:function(){return this.max-this.range},setTickInterval:function(k){var c=this,e=c.chart,h=c.options,n=c.isLog,d=c.log2lin,v=c.isDatetimeAxis,y=c.isXAxis,p=c.isLinked,t=h.maxPadding,x=h.minPadding,g=h.tickInterval,E=h.tickPixelInterval,q=c.categories,J=c.threshold,
K=c.softThreshold,I,r,u,A;v||q||p||this.getTickAmount();u=w(c.userMin,h.min);A=w(c.userMax,h.max);p?(c.linkedParent=e[c.coll][h.linkedTo],e=c.linkedParent.getExtremes(),c.min=w(e.min,e.dataMin),c.max=w(e.max,e.dataMax),h.type!==c.linkedParent.options.type&&a.error(11,1)):(!K&&l(J)&&(c.dataMin>=J?(I=J,x=0):c.dataMax<=J&&(r=J,t=0)),c.min=w(u,I,c.dataMin),c.max=w(A,r,c.dataMax));n&&(!k&&0>=Math.min(c.min,w(c.dataMin,c.min))&&a.error(10,1),c.min=f(d(c.min),15),c.max=f(d(c.max),15));c.range&&l(c.max)&&
(c.userMin=c.min=u=Math.max(c.min,c.minFromRange()),c.userMax=A=c.max,c.range=null);C(c,"foundExtremes");c.beforePadding&&c.beforePadding();c.adjustForMinRange();!(q||c.axisPointRange||c.usePercentage||p)&&l(c.min)&&l(c.max)&&(d=c.max-c.min)&&(!l(u)&&x&&(c.min-=d*x),!l(A)&&t&&(c.max+=d*t));z(h.floor)?c.min=Math.max(c.min,h.floor):z(h.softMin)&&(c.min=Math.min(c.min,h.softMin));z(h.ceiling)?c.max=Math.min(c.max,h.ceiling):z(h.softMax)&&(c.max=Math.max(c.max,h.softMax));K&&l(c.dataMin)&&(J=J||0,!l(u)&&
c.min<J&&c.dataMin>=J?c.min=J:!l(A)&&c.max>J&&c.dataMax<=J&&(c.max=J));c.tickInterval=c.min===c.max||void 0===c.min||void 0===c.max?1:p&&!g&&E===c.linkedParent.options.tickPixelInterval?g=c.linkedParent.tickInterval:w(g,this.tickAmount?(c.max-c.min)/Math.max(this.tickAmount-1,1):void 0,q?1:(c.max-c.min)*E/Math.max(c.len,E));y&&!k&&b(c.series,function(a){a.processData(c.min!==c.oldMin||c.max!==c.oldMax)});c.setAxisTranslation(!0);c.beforeSetTickPositions&&c.beforeSetTickPositions();c.postProcessTickInterval&&
(c.tickInterval=c.postProcessTickInterval(c.tickInterval));c.pointRange&&!g&&(c.tickInterval=Math.max(c.pointRange,c.tickInterval));k=w(h.minTickInterval,c.isDatetimeAxis&&c.closestPointRange);!g&&c.tickInterval<k&&(c.tickInterval=k);v||n||g||(c.tickInterval=F(c.tickInterval,null,m(c.tickInterval),w(h.allowDecimals,!(.5<c.tickInterval&&5>c.tickInterval&&1E3<c.max&&9999>c.max)),!!this.tickAmount));this.tickAmount||(c.tickInterval=c.unsquish());this.setTickPositions()},setTickPositions:function(){var a=
this.options,b,c=a.tickPositions,e=a.tickPositioner,h=a.startOnTick,n=a.endOnTick,m;this.tickmarkOffset=this.categories&&"between"===a.tickmarkPlacement&&1===this.tickInterval?.5:0;this.minorTickInterval="auto"===a.minorTickInterval&&this.tickInterval?this.tickInterval/5:a.minorTickInterval;this.tickPositions=b=c&&c.slice();!b&&(b=this.isDatetimeAxis?this.getTimeTicks(this.normalizeTimeTickInterval(this.tickInterval,a.units),this.min,this.max,a.startOfWeek,this.ordinalPositions,this.closestPointRange,
!0):this.isLog?this.getLogTickPositions(this.tickInterval,this.min,this.max):this.getLinearTickPositions(this.tickInterval,this.min,this.max),b.length>this.len&&(b=[b[0],b.pop()]),this.tickPositions=b,e&&(e=e.apply(this,[this.min,this.max])))&&(this.tickPositions=b=e);this.trimTicks(b,h,n);this.isLinked||(this.min===this.max&&l(this.min)&&!this.tickAmount&&(m=!0,this.min-=.5,this.max+=.5),this.single=m,c||e||this.adjustTickAmount())},trimTicks:function(a,b,c){var k=a[0],e=a[a.length-1],h=this.minPointOffset||
0;if(!this.isLinked){if(b)this.min=k;else for(;this.min-h>a[0];)a.shift();if(c)this.max=e;else for(;this.max+h<a[a.length-1];)a.pop();0===a.length&&l(k)&&a.push((e+k)/2)}},alignToOthers:function(){var a={},c,e=this.options;!1===this.chart.options.chart.alignTicks||!1===e.alignTicks||this.isLog||b(this.chart[this.coll],function(b){var k=b.options,k=[b.horiz?k.left:k.top,k.width,k.height,k.pane].join();b.series.length&&(a[k]?c=!0:a[k]=1)});return c},getTickAmount:function(){var a=this.options,b=a.tickAmount,
c=a.tickPixelInterval;!l(a.tickInterval)&&this.len<c&&!this.isRadial&&!this.isLog&&a.startOnTick&&a.endOnTick&&(b=2);!b&&this.alignToOthers()&&(b=Math.ceil(this.len/c)+1);4>b&&(this.finalTickAmt=b,b=5);this.tickAmount=b},adjustTickAmount:function(){var a=this.tickInterval,b=this.tickPositions,c=this.tickAmount,e=this.finalTickAmt,h=b&&b.length;if(h<c){for(;b.length<c;)b.push(f(b[b.length-1]+a));this.transA*=(h-1)/(c-1);this.max=b[b.length-1]}else h>c&&(this.tickInterval*=2,this.setTickPositions());
if(l(e)){for(a=c=b.length;a--;)(3===e&&1===a%2||2>=e&&0<a&&a<c-1)&&b.splice(a,1);this.finalTickAmt=void 0}},setScale:function(){var a,c;this.oldMin=this.min;this.oldMax=this.max;this.oldAxisLength=this.len;this.setAxisSize();c=this.len!==this.oldAxisLength;b(this.series,function(b){if(b.isDirtyData||b.isDirty||b.xAxis.isDirty)a=!0});c||a||this.isLinked||this.forceRedraw||this.userMin!==this.oldUserMin||this.userMax!==this.oldUserMax||this.alignToOthers()?(this.resetStacks&&this.resetStacks(),this.forceRedraw=
!1,this.getSeriesExtremes(),this.setTickInterval(),this.oldUserMin=this.userMin,this.oldUserMax=this.userMax,this.isDirty||(this.isDirty=c||this.min!==this.oldMin||this.max!==this.oldMax)):this.cleanStacks&&this.cleanStacks()},setExtremes:function(a,c,e,h,n){var k=this,m=k.chart;e=w(e,!0);b(k.series,function(a){delete a.kdTree});n=p(n,{min:a,max:c});C(k,"setExtremes",n,function(){k.userMin=a;k.userMax=c;k.eventArgs=n;e&&m.redraw(h)})},zoom:function(a,b){var c=this.dataMin,k=this.dataMax,e=this.options,
h=Math.min(c,w(e.min,c)),e=Math.max(k,w(e.max,k));if(a!==this.min||b!==this.max)this.allowZoomOutside||(l(c)&&(a<h&&(a=h),a>e&&(a=e)),l(k)&&(b<h&&(b=h),b>e&&(b=e))),this.displayBtn=void 0!==a||void 0!==b,this.setExtremes(a,b,!1,void 0,{trigger:"zoom"});return!0},setAxisSize:function(){var a=this.chart,b=this.options,c=b.offsets||[0,0,0,0],e=this.horiz,h=w(b.width,a.plotWidth-c[3]+c[1]),n=w(b.height,a.plotHeight-c[0]+c[2]),m=w(b.top,a.plotTop+c[0]),b=w(b.left,a.plotLeft+c[3]),c=/%$/;c.test(n)&&(n=
Math.round(parseFloat(n)/100*a.plotHeight));c.test(m)&&(m=Math.round(parseFloat(m)/100*a.plotHeight+a.plotTop));this.left=b;this.top=m;this.width=h;this.height=n;this.bottom=a.chartHeight-n-m;this.right=a.chartWidth-h-b;this.len=Math.max(e?h:n,0);this.pos=e?b:m},getExtremes:function(){var a=this.isLog,b=this.lin2log;return{min:a?f(b(this.min)):this.min,max:a?f(b(this.max)):this.max,dataMin:this.dataMin,dataMax:this.dataMax,userMin:this.userMin,userMax:this.userMax}},getThreshold:function(a){var b=
this.isLog,c=this.lin2log,k=b?c(this.min):this.min,b=b?c(this.max):this.max;null===a?a=k:k>a?a=k:b<a&&(a=b);return this.translate(a,0,1,0,1)},autoLabelAlign:function(a){a=(w(a,0)-90*this.side+720)%360;return 15<a&&165>a?"right":195<a&&345>a?"left":"center"},tickSize:function(a){var b=this.options,c=b[a+"Length"],k=w(b[a+"Width"],"tick"===a&&this.isXAxis?1:0);if(k&&c)return"inside"===b[a+"Position"]&&(c=-c),[c,k]},labelMetrics:function(){return this.chart.renderer.fontMetrics(this.options.labels.style&&
this.options.labels.style.fontSize,this.ticks[0]&&this.ticks[0].label)},unsquish:function(){var a=this.options.labels,c=this.horiz,e=this.tickInterval,h=e,n=this.len/(((this.categories?1:0)+this.max-this.min)/e),m,d=a.rotation,f=this.labelMetrics(),p,y=Number.MAX_VALUE,t,x=function(a){a/=n||1;a=1<a?Math.ceil(a):1;return a*e};c?(t=!a.staggerLines&&!a.step&&(l(d)?[d]:n<w(a.autoRotationLimit,80)&&a.autoRotation))&&b(t,function(a){var b;if(a===d||a&&-90<=a&&90>=a)p=x(Math.abs(f.h/Math.sin(q*a))),b=p+
Math.abs(a/360),b<y&&(y=b,m=a,h=p)}):a.step||(h=x(f.h));this.autoRotation=t;this.labelRotation=w(m,d);return h},getSlotWidth:function(){var a=this.chart,b=this.horiz,c=this.options.labels,e=Math.max(this.tickPositions.length-(this.categories?0:1),1),h=a.margin[3];return b&&2>(c.step||0)&&!c.rotation&&(this.staggerLines||1)*this.len/e||!b&&(h&&h-a.spacing[3]||.33*a.chartWidth)},renderUnsquish:function(){var a=this.chart,c=a.renderer,h=this.tickPositions,n=this.ticks,m=this.options.labels,d=this.horiz,
v=this.getSlotWidth(),f=Math.max(1,Math.round(v-2*(m.padding||5))),p={},y=this.labelMetrics(),t=m.style&&m.style.textOverflow,g,z=0,E,w;e(m.rotation)||(p.rotation=m.rotation||0);b(h,function(a){(a=n[a])&&a.labelLength>z&&(z=a.labelLength)});this.maxLabelLength=z;if(this.autoRotation)z>f&&z>y.h?p.rotation=this.labelRotation:this.labelRotation=0;else if(v&&(g={width:f+"px"},!t))for(g.textOverflow="clip",E=h.length;!d&&E--;)if(w=h[E],f=n[w].label)f.styles&&"ellipsis"===f.styles.textOverflow?f.css({textOverflow:"clip"}):
n[w].labelLength>v&&f.css({width:v+"px"}),f.getBBox().height>this.len/h.length-(y.h-y.f)&&(f.specCss={textOverflow:"ellipsis"});p.rotation&&(g={width:(z>.5*a.chartHeight?.33*a.chartHeight:a.chartHeight)+"px"},t||(g.textOverflow="ellipsis"));if(this.labelAlign=m.align||this.autoLabelAlign(this.labelRotation))p.align=this.labelAlign;b(h,function(a){var b=(a=n[a])&&a.label;b&&(b.attr(p),g&&b.css(x(g,b.specCss)),delete b.specCss,a.rotation=p.rotation)});this.tickRotCorr=c.rotCorr(y.b,this.labelRotation||
0,0!==this.side)},hasData:function(){return this.hasVisibleSeries||l(this.min)&&l(this.max)&&!!this.tickPositions},addTitle:function(a){var b=this.chart.renderer,c=this.horiz,k=this.opposite,e=this.options.title,h;this.axisTitle||((h=e.textAlign)||(h=(c?{low:"left",middle:"center",high:"right"}:{low:k?"right":"left",middle:"center",high:k?"left":"right"})[e.align]),this.axisTitle=b.text(e.text,0,0,e.useHTML).attr({zIndex:7,rotation:e.rotation||0,align:h}).addClass("highcharts-axis-title").css(e.style).add(this.axisGroup),
this.axisTitle.isNew=!0);this.axisTitle[a?"show":"hide"](!0)},generateTick:function(a){var b=this.ticks;b[a]?b[a].addLabel():b[a]=new I(this,a)},getOffset:function(){var a=this,c=a.chart,e=c.renderer,h=a.options,n=a.tickPositions,m=a.ticks,d=a.horiz,f=a.side,p=c.inverted?[1,0,3,2][f]:f,y,t,x=0,g,z=0,E=h.title,q=h.labels,F=0,J=c.axisOffset,c=c.clipOffset,K=[-1,1,1,-1][f],C,I=h.className,r=a.axisParent,u=this.tickSize("tick");y=a.hasData();a.showAxis=t=y||w(h.showEmpty,!0);a.staggerLines=a.horiz&&q.staggerLines;
a.axisGroup||(a.gridGroup=e.g("grid").attr({zIndex:h.gridZIndex||1}).addClass("highcharts-"+this.coll.toLowerCase()+"-grid "+(I||"")).add(r),a.axisGroup=e.g("axis").attr({zIndex:h.zIndex||2}).addClass("highcharts-"+this.coll.toLowerCase()+" "+(I||"")).add(r),a.labelGroup=e.g("axis-labels").attr({zIndex:q.zIndex||7}).addClass("highcharts-"+a.coll.toLowerCase()+"-labels "+(I||"")).add(r));if(y||a.isLinked)b(n,function(b,c){a.generateTick(b,c)}),a.renderUnsquish(),!1===q.reserveSpace||0!==f&&2!==f&&
{1:"left",3:"right"}[f]!==a.labelAlign&&"center"!==a.labelAlign||b(n,function(a){F=Math.max(m[a].getLabelSize(),F)}),a.staggerLines&&(F*=a.staggerLines,a.labelOffset=F*(a.opposite?-1:1));else for(C in m)m[C].destroy(),delete m[C];E&&E.text&&!1!==E.enabled&&(a.addTitle(t),t&&(x=a.axisTitle.getBBox()[d?"height":"width"],g=E.offset,z=l(g)?0:w(E.margin,d?5:10)));a.renderLine();a.offset=K*w(h.offset,J[f]);a.tickRotCorr=a.tickRotCorr||{x:0,y:0};e=0===f?-a.labelMetrics().h:2===f?a.tickRotCorr.y:0;z=Math.abs(F)+
z;F&&(z=z-e+K*(d?w(q.y,a.tickRotCorr.y+8*K):q.x));a.axisTitleMargin=w(g,z);J[f]=Math.max(J[f],a.axisTitleMargin+x+K*a.offset,z,y&&n.length&&u?u[0]:0);h=h.offset?0:2*Math.floor(a.axisLine.strokeWidth()/2);c[p]=Math.max(c[p],h)},getLinePath:function(a){var b=this.chart,c=this.opposite,k=this.offset,e=this.horiz,h=this.left+(c?this.width:0)+k,k=b.chartHeight-this.bottom-(c?this.height:0)+k;c&&(a*=-1);return b.renderer.crispLine(["M",e?this.left:h,e?k:this.top,"L",e?b.chartWidth-this.right:h,e?k:b.chartHeight-
this.bottom],a)},renderLine:function(){this.axisLine||(this.axisLine=this.chart.renderer.path().addClass("highcharts-axis-line").add(this.axisGroup),this.axisLine.attr({stroke:this.options.lineColor,"stroke-width":this.options.lineWidth,zIndex:7}))},getTitlePosition:function(){var a=this.horiz,b=this.left,c=this.top,e=this.len,h=this.options.title,n=a?b:c,m=this.opposite,d=this.offset,f=h.x||0,p=h.y||0,y=this.chart.renderer.fontMetrics(h.style&&h.style.fontSize,this.axisTitle).f,e={low:n+(a?0:e),
middle:n+e/2,high:n+(a?e:0)}[h.align],b=(a?c+this.height:b)+(a?1:-1)*(m?-1:1)*this.axisTitleMargin+(2===this.side?y:0);return{x:a?e+f:b+(m?this.width:0)+d+f,y:a?b+p-(m?this.height:0)+d:e+p}},renderMinorTick:function(a){var b=this.chart.hasRendered&&z(this.oldMin),c=this.minorTicks;c[a]||(c[a]=new I(this,a,"minor"));b&&c[a].isNew&&c[a].render(null,!0);c[a].render(null,!1,1)},renderTick:function(a,b){var c=this.isLinked,e=this.ticks,k=this.chart.hasRendered&&z(this.oldMin);if(!c||a>=this.min&&a<=this.max)e[a]||
(e[a]=new I(this,a)),k&&e[a].isNew&&e[a].render(b,!0,.1),e[a].render(b)},render:function(){var a=this,c=a.chart,e=a.options,n=a.isLog,m=a.lin2log,d=a.isLinked,v=a.tickPositions,f=a.axisTitle,p=a.ticks,y=a.minorTicks,t=a.alternateBands,x=e.stackLabels,z=e.alternateGridColor,g=a.tickmarkOffset,E=a.axisLine,w=a.showAxis,l=A(c.renderer.globalAnimation),q,F;a.labelEdge.length=0;a.overlap=!1;b([p,y,t],function(a){for(var b in a)a[b].isActive=!1});if(a.hasData()||d)a.minorTickInterval&&!a.categories&&b(a.getMinorTickPositions(),
function(b){a.renderMinorTick(b)}),v.length&&(b(v,function(b,c){a.renderTick(b,c)}),g&&(0===a.min||a.single)&&(p[-1]||(p[-1]=new I(a,-1,null,!0)),p[-1].render(-1))),z&&b(v,function(b,e){F=void 0!==v[e+1]?v[e+1]+g:a.max-g;0===e%2&&b<a.max&&F<=a.max+(c.polar?-g:g)&&(t[b]||(t[b]=new h(a)),q=b+g,t[b].options={from:n?m(q):q,to:n?m(F):F,color:z},t[b].render(),t[b].isActive=!0)}),a._addedPlotLB||(b((e.plotLines||[]).concat(e.plotBands||[]),function(b){a.addPlotBandOrLine(b)}),a._addedPlotLB=!0);b([p,y,t],
function(a){var b,e,h=[],k=l.duration;for(b in a)a[b].isActive||(a[b].render(b,!1,0),a[b].isActive=!1,h.push(b));K(function(){for(e=h.length;e--;)a[h[e]]&&!a[h[e]].isActive&&(a[h[e]].destroy(),delete a[h[e]])},a!==t&&c.hasRendered&&k?k:0)});E&&(E[E.isPlaced?"animate":"attr"]({d:this.getLinePath(E.strokeWidth())}),E.isPlaced=!0,E[w?"show":"hide"](!0));f&&w&&(f[f.isNew?"attr":"animate"](a.getTitlePosition()),f.isNew=!1);x&&x.enabled&&a.renderStackTotals();a.isDirty=!1},redraw:function(){this.visible&&
(this.render(),b(this.plotLinesAndBands,function(a){a.render()}));b(this.series,function(a){a.isDirty=!0})},keepProps:"extKey hcEvents names series userMax userMin".split(" "),destroy:function(a){var c=this,e=c.stacks,h,k=c.plotLinesAndBands,m;a||y(c);for(h in e)d(e[h]),e[h]=null;b([c.ticks,c.minorTicks,c.alternateBands],function(a){d(a)});if(k)for(a=k.length;a--;)k[a].destroy();b("stackTotalGroup axisLine axisTitle axisGroup gridGroup labelGroup cross".split(" "),function(a){c[a]&&(c[a]=c[a].destroy())});
for(m in c)c.hasOwnProperty(m)&&-1===n(m,c.keepProps)&&delete c[m]},drawCrosshair:function(a,b){var c,e=this.crosshair,h=w(e.snap,!0),k,n=this.cross;a||(a=this.cross&&this.cross.e);this.crosshair&&!1!==(l(b)||!h)?(h?l(b)&&(k=this.isXAxis?b.plotX:this.len-b.plotY):k=a&&(this.horiz?a.chartX-this.pos:this.len-a.chartY+this.pos),l(k)&&(c=this.getPlotLinePath(b&&(this.isXAxis?b.x:w(b.stackY,b.y)),null,null,null,k)||null),l(c)?(b=this.categories&&!this.isRadial,n||(this.cross=n=this.chart.renderer.path().addClass("highcharts-crosshair highcharts-crosshair-"+
(b?"category ":"thin ")+e.className).attr({zIndex:w(e.zIndex,2)}).add(),n.attr({stroke:e.color||(b?g("#ccd6eb").setOpacity(.25).get():"#cccccc"),"stroke-width":w(e.width,1)}),e.dashStyle&&n.attr({dashstyle:e.dashStyle})),n.show().attr({d:c}),b&&!e.width&&n.attr({"stroke-width":this.transA}),this.cross.e=a):this.hideCrosshair()):this.hideCrosshair()},hideCrosshair:function(){this.cross&&this.cross.hide()}};p(a.Axis.prototype,r)})(L);(function(a){var B=a.Axis,A=a.Date,H=a.dateFormat,G=a.defaultOptions,
r=a.defined,g=a.each,f=a.extend,u=a.getMagnitude,l=a.getTZOffset,q=a.normalizeTickInterval,d=a.pick,b=a.timeUnits;B.prototype.getTimeTicks=function(a,q,t,m){var c=[],n={},p=G.global.useUTC,z,e=new A(q-l(q)),x=A.hcMakeTime,F=a.unitRange,w=a.count,h;if(r(q)){e[A.hcSetMilliseconds](F>=b.second?0:w*Math.floor(e.getMilliseconds()/w));if(F>=b.second)e[A.hcSetSeconds](F>=b.minute?0:w*Math.floor(e.getSeconds()/w));if(F>=b.minute)e[A.hcSetMinutes](F>=b.hour?0:w*Math.floor(e[A.hcGetMinutes]()/w));if(F>=b.hour)e[A.hcSetHours](F>=
b.day?0:w*Math.floor(e[A.hcGetHours]()/w));if(F>=b.day)e[A.hcSetDate](F>=b.month?1:w*Math.floor(e[A.hcGetDate]()/w));F>=b.month&&(e[A.hcSetMonth](F>=b.year?0:w*Math.floor(e[A.hcGetMonth]()/w)),z=e[A.hcGetFullYear]());if(F>=b.year)e[A.hcSetFullYear](z-z%w);if(F===b.week)e[A.hcSetDate](e[A.hcGetDate]()-e[A.hcGetDay]()+d(m,1));z=e[A.hcGetFullYear]();m=e[A.hcGetMonth]();var y=e[A.hcGetDate](),J=e[A.hcGetHours]();if(A.hcTimezoneOffset||A.hcGetTimezoneOffset)h=(!p||!!A.hcGetTimezoneOffset)&&(t-q>4*b.month||
l(q)!==l(t)),e=e.getTime(),e=new A(e+l(e));p=e.getTime();for(q=1;p<t;)c.push(p),p=F===b.year?x(z+q*w,0):F===b.month?x(z,m+q*w):!h||F!==b.day&&F!==b.week?h&&F===b.hour?x(z,m,y,J+q*w):p+F*w:x(z,m,y+q*w*(F===b.day?1:7)),q++;c.push(p);F<=b.hour&&1E4>c.length&&g(c,function(a){0===a%18E5&&"000000000"===H("%H%M%S%L",a)&&(n[a]="day")})}c.info=f(a,{higherRanks:n,totalRange:F*w});return c};B.prototype.normalizeTimeTickInterval=function(a,d){var f=d||[["millisecond",[1,2,5,10,20,25,50,100,200,500]],["second",
[1,2,5,10,15,30]],["minute",[1,2,5,10,15,30]],["hour",[1,2,3,4,6,8,12]],["day",[1,2]],["week",[1,2]],["month",[1,2,3,4,6]],["year",null]];d=f[f.length-1];var m=b[d[0]],c=d[1],n;for(n=0;n<f.length&&!(d=f[n],m=b[d[0]],c=d[1],f[n+1]&&a<=(m*c[c.length-1]+b[f[n+1][0]])/2);n++);m===b.year&&a<5*m&&(c=[1,2,5]);a=q(a/m,c,"year"===d[0]?Math.max(u(a/m),1):1);return{unitRange:m,count:a,unitName:d[0]}}})(L);(function(a){var B=a.Axis,A=a.getMagnitude,H=a.map,G=a.normalizeTickInterval,r=a.pick;B.prototype.getLogTickPositions=
function(a,f,u,l){var g=this.options,d=this.len,b=this.lin2log,p=this.log2lin,C=[];l||(this._minorAutoInterval=null);if(.5<=a)a=Math.round(a),C=this.getLinearTickPositions(a,f,u);else if(.08<=a)for(var d=Math.floor(f),t,m,c,n,E,g=.3<a?[1,2,4]:.15<a?[1,2,4,6,8]:[1,2,3,4,5,6,7,8,9];d<u+1&&!E;d++)for(m=g.length,t=0;t<m&&!E;t++)c=p(b(d)*g[t]),c>f&&(!l||n<=u)&&void 0!==n&&C.push(n),n>u&&(E=!0),n=c;else f=b(f),u=b(u),a=g[l?"minorTickInterval":"tickInterval"],a=r("auto"===a?null:a,this._minorAutoInterval,
g.tickPixelInterval/(l?5:1)*(u-f)/((l?d/this.tickPositions.length:d)||1)),a=G(a,null,A(a)),C=H(this.getLinearTickPositions(a,f,u),p),l||(this._minorAutoInterval=a/5);l||(this.tickInterval=a);return C};B.prototype.log2lin=function(a){return Math.log(a)/Math.LN10};B.prototype.lin2log=function(a){return Math.pow(10,a)}})(L);(function(a){var B=a.dateFormat,A=a.each,H=a.extend,G=a.format,r=a.isNumber,g=a.map,f=a.merge,u=a.pick,l=a.splat,q=a.syncTimeout,d=a.timeUnits;a.Tooltip=function(){this.init.apply(this,
arguments)};a.Tooltip.prototype={init:function(a,d){this.chart=a;this.options=d;this.crosshairs=[];this.now={x:0,y:0};this.isHidden=!0;this.split=d.split&&!a.inverted;this.shared=d.shared||this.split},cleanSplit:function(a){A(this.chart.series,function(b){var d=b&&b.tt;d&&(!d.isActive||a?b.tt=d.destroy():d.isActive=!1)})},getLabel:function(){var a=this.chart.renderer,d=this.options;this.label||(this.split?this.label=a.g("tooltip"):(this.label=a.label("",0,0,d.shape||"callout",null,null,d.useHTML,
null,"tooltip").attr({padding:d.padding,r:d.borderRadius}),this.label.attr({fill:d.backgroundColor,"stroke-width":d.borderWidth}).css(d.style).shadow(d.shadow)),this.label.attr({zIndex:8}).add());return this.label},update:function(a){this.destroy();this.init(this.chart,f(!0,this.options,a))},destroy:function(){this.label&&(this.label=this.label.destroy());this.split&&this.tt&&(this.cleanSplit(this.chart,!0),this.tt=this.tt.destroy());clearTimeout(this.hideTimer);clearTimeout(this.tooltipTimeout)},
move:function(a,d,f,t){var b=this,c=b.now,n=!1!==b.options.animation&&!b.isHidden&&(1<Math.abs(a-c.x)||1<Math.abs(d-c.y)),p=b.followPointer||1<b.len;H(c,{x:n?(2*c.x+a)/3:a,y:n?(c.y+d)/2:d,anchorX:p?void 0:n?(2*c.anchorX+f)/3:f,anchorY:p?void 0:n?(c.anchorY+t)/2:t});b.getLabel().attr(c);n&&(clearTimeout(this.tooltipTimeout),this.tooltipTimeout=setTimeout(function(){b&&b.move(a,d,f,t)},32))},hide:function(a){var b=this;clearTimeout(this.hideTimer);a=u(a,this.options.hideDelay,500);this.isHidden||(this.hideTimer=
q(function(){b.getLabel()[a?"fadeOut":"hide"]();b.isHidden=!0},a))},getAnchor:function(a,d){var b,f=this.chart,m=f.inverted,c=f.plotTop,n=f.plotLeft,p=0,z=0,e,x;a=l(a);b=a[0].tooltipPos;this.followPointer&&d&&(void 0===d.chartX&&(d=f.pointer.normalize(d)),b=[d.chartX-f.plotLeft,d.chartY-c]);b||(A(a,function(a){e=a.series.yAxis;x=a.series.xAxis;p+=a.plotX+(!m&&x?x.left-n:0);z+=(a.plotLow?(a.plotLow+a.plotHigh)/2:a.plotY)+(!m&&e?e.top-c:0)}),p/=a.length,z/=a.length,b=[m?f.plotWidth-z:p,this.shared&&
!m&&1<a.length&&d?d.chartY-c:m?f.plotHeight-p:z]);return g(b,Math.round)},getPosition:function(a,d,f){var b=this.chart,m=this.distance,c={},n=f.h||0,p,z=["y",b.chartHeight,d,f.plotY+b.plotTop,b.plotTop,b.plotTop+b.plotHeight],e=["x",b.chartWidth,a,f.plotX+b.plotLeft,b.plotLeft,b.plotLeft+b.plotWidth],x=!this.followPointer&&u(f.ttBelow,!b.inverted===!!f.negative),g=function(a,b,e,h,d,f){var k=e<h-m,y=h+m+e<b,p=h-m-e;h+=m;if(x&&y)c[a]=h;else if(!x&&k)c[a]=p;else if(k)c[a]=Math.min(f-e,0>p-n?p:p-n);
else if(y)c[a]=Math.max(d,h+n+e>b?h:h+n);else return!1},w=function(a,b,e,h){var k;h<m||h>b-m?k=!1:c[a]=h<e/2?1:h>b-e/2?b-e-2:h-e/2;return k},h=function(a){var b=z;z=e;e=b;p=a},y=function(){!1!==g.apply(0,z)?!1!==w.apply(0,e)||p||(h(!0),y()):p?c.x=c.y=0:(h(!0),y())};(b.inverted||1<this.len)&&h();y();return c},defaultFormatter:function(a){var b=this.points||l(this),d;d=[a.tooltipFooterHeaderFormatter(b[0])];d=d.concat(a.bodyFormatter(b));d.push(a.tooltipFooterHeaderFormatter(b[0],!0));return d},refresh:function(a,
d){var b=this.chart,f,m=this.options,c,n,p={},z=[];f=m.formatter||this.defaultFormatter;var p=b.hoverPoints,e=this.shared;clearTimeout(this.hideTimer);this.followPointer=l(a)[0].series.tooltipOptions.followPointer;n=this.getAnchor(a,d);d=n[0];c=n[1];!e||a.series&&a.series.noSharedTooltip?p=a.getLabelConfig():(b.hoverPoints=a,p&&A(p,function(a){a.setState()}),A(a,function(a){a.setState("hover");z.push(a.getLabelConfig())}),p={x:a[0].category,y:a[0].y},p.points=z,a=a[0]);this.len=z.length;p=f.call(p,
this);e=a.series;this.distance=u(e.tooltipOptions.distance,16);!1===p?this.hide():(f=this.getLabel(),this.isHidden&&f.attr({opacity:1}).show(),this.split?this.renderSplit(p,b.hoverPoints):(f.attr({text:p&&p.join?p.join(""):p}),f.removeClass(/highcharts-color-[\d]+/g).addClass("highcharts-color-"+u(a.colorIndex,e.colorIndex)),f.attr({stroke:m.borderColor||a.color||e.color||"#666666"}),this.updatePosition({plotX:d,plotY:c,negative:a.negative,ttBelow:a.ttBelow,h:n[2]||0})),this.isHidden=!1)},renderSplit:function(b,
d){var f=this,p=[],m=this.chart,c=m.renderer,n=!0,g=this.options,z,e=this.getLabel();A(b.slice(0,d.length+1),function(a,b){b=d[b-1]||{isHeader:!0,plotX:d[0].plotX};var x=b.series||f,h=x.tt,y=b.series||{},t="highcharts-color-"+u(b.colorIndex,y.colorIndex,"none");h||(x.tt=h=c.label(null,null,null,"callout").addClass("highcharts-tooltip-box "+t).attr({padding:g.padding,r:g.borderRadius,fill:g.backgroundColor,stroke:b.color||y.color||"#333333","stroke-width":g.borderWidth}).add(e));h.isActive=!0;h.attr({text:a});
h.css(g.style);a=h.getBBox();y=a.width+h.strokeWidth();b.isHeader?(z=a.height,y=Math.max(0,Math.min(b.plotX+m.plotLeft-y/2,m.chartWidth-y))):y=b.plotX+m.plotLeft-u(g.distance,16)-y;0>y&&(n=!1);a=(b.series&&b.series.yAxis&&b.series.yAxis.pos)+(b.plotY||0);a-=m.plotTop;p.push({target:b.isHeader?m.plotHeight+z:a,rank:b.isHeader?1:0,size:x.tt.getBBox().height+1,point:b,x:y,tt:h})});this.cleanSplit();a.distribute(p,m.plotHeight+z);A(p,function(a){var b=a.point,c=b.series;a.tt.attr({visibility:void 0===
a.pos?"hidden":"inherit",x:n||b.isHeader?a.x:b.plotX+m.plotLeft+u(g.distance,16),y:a.pos+m.plotTop,anchorX:b.isHeader?b.plotX+m.plotLeft:b.plotX+c.xAxis.pos,anchorY:b.isHeader?a.pos+m.plotTop-15:b.plotY+c.yAxis.pos})})},updatePosition:function(a){var b=this.chart,d=this.getLabel(),d=(this.options.positioner||this.getPosition).call(this,d.width,d.height,a);this.move(Math.round(d.x),Math.round(d.y||0),a.plotX+b.plotLeft,a.plotY+b.plotTop)},getDateFormat:function(a,f,g,t){var b=B("%m-%d %H:%M:%S.%L",
f),c,n,p={millisecond:15,second:12,minute:9,hour:6,day:3},z="millisecond";for(n in d){if(a===d.week&&+B("%w",f)===g&&"00:00:00.000"===b.substr(6)){n="week";break}if(d[n]>a){n=z;break}if(p[n]&&b.substr(p[n])!=="01-01 00:00:00.000".substr(p[n]))break;"week"!==n&&(z=n)}n&&(c=t[n]);return c},getXDateFormat:function(a,d,f){d=d.dateTimeLabelFormats;var b=f&&f.closestPointRange;return(b?this.getDateFormat(b,a.x,f.options.startOfWeek,d):d.day)||d.year},tooltipFooterHeaderFormatter:function(a,d){var b=d?"footer":
"header";d=a.series;var f=d.tooltipOptions,m=f.xDateFormat,c=d.xAxis,n=c&&"datetime"===c.options.type&&r(a.key),b=f[b+"Format"];n&&!m&&(m=this.getXDateFormat(a,f,c));n&&m&&(b=b.replace("{point.key}","{point.key:"+m+"}"));return G(b,{point:a,series:d})},bodyFormatter:function(a){return g(a,function(a){var b=a.series.tooltipOptions;return(b.pointFormatter||a.point.tooltipFormatter).call(a.point,b.pointFormat)})}}})(L);(function(a){var B=a.addEvent,A=a.attr,H=a.charts,G=a.color,r=a.css,g=a.defined,f=
a.doc,u=a.each,l=a.extend,q=a.fireEvent,d=a.offset,b=a.pick,p=a.removeEvent,C=a.splat,t=a.Tooltip,m=a.win;a.Pointer=function(a,b){this.init(a,b)};a.Pointer.prototype={init:function(a,d){this.options=d;this.chart=a;this.runChartClick=d.chart.events&&!!d.chart.events.click;this.pinchDown=[];this.lastValidTouch={};t&&d.tooltip.enabled&&(a.tooltip=new t(a,d.tooltip),this.followTouchMove=b(d.tooltip.followTouchMove,!0));this.setDOMEvents()},zoomOption:function(a){var c=this.chart,d=c.options.chart,m=d.zoomType||
"",c=c.inverted;/touch/.test(a.type)&&(m=b(d.pinchType,m));this.zoomX=a=/x/.test(m);this.zoomY=m=/y/.test(m);this.zoomHor=a&&!c||m&&c;this.zoomVert=m&&!c||a&&c;this.hasZoom=a||m},normalize:function(a,b){var c,n;a=a||m.event;a.target||(a.target=a.srcElement);n=a.touches?a.touches.length?a.touches.item(0):a.changedTouches[0]:a;b||(this.chartPosition=b=d(this.chart.container));void 0===n.pageX?(c=Math.max(a.x,a.clientX-b.left),b=a.y):(c=n.pageX-b.left,b=n.pageY-b.top);return l(a,{chartX:Math.round(c),
chartY:Math.round(b)})},getCoordinates:function(a){var b={xAxis:[],yAxis:[]};u(this.chart.axes,function(c){b[c.isXAxis?"xAxis":"yAxis"].push({axis:c,value:c.toValue(a[c.horiz?"chartX":"chartY"])})});return b},runPointActions:function(c){var d=this.chart,m=d.series,p=d.tooltip,e=p?p.shared:!1,g=!0,t=d.hoverPoint,w=d.hoverSeries,h,y,l,q=[],r;if(!e&&!w)for(h=0;h<m.length;h++)if(m[h].directTouch||!m[h].options.stickyTracking)m=[];w&&(e?w.noSharedTooltip:w.directTouch)&&t?q=[t]:(e||!w||w.options.stickyTracking||
(m=[w]),u(m,function(a){y=a.noSharedTooltip&&e;l=!e&&a.directTouch;a.visible&&!y&&!l&&b(a.options.enableMouseTracking,!0)&&(r=a.searchPoint(c,!y&&1===a.kdDimensions))&&r.series&&q.push(r)}),q.sort(function(a,b){var c=a.distX-b.distX,h=a.dist-b.dist,k=(b.series.group&&b.series.group.zIndex)-(a.series.group&&a.series.group.zIndex);return 0!==c&&e?c:0!==h?h:0!==k?k:a.series.index>b.series.index?-1:1}));if(e)for(h=q.length;h--;)(q[h].x!==q[0].x||q[h].series.noSharedTooltip)&&q.splice(h,1);if(q[0]&&(q[0]!==
this.prevKDPoint||p&&p.isHidden)){if(e&&!q[0].series.noSharedTooltip){for(h=0;h<q.length;h++)q[h].onMouseOver(c,q[h]!==(w&&w.directTouch&&t||q[0]));q.length&&p&&p.refresh(q.sort(function(a,b){return a.series.index-b.series.index}),c)}else if(p&&p.refresh(q[0],c),!w||!w.directTouch)q[0].onMouseOver(c);this.prevKDPoint=q[0];g=!1}g&&(m=w&&w.tooltipOptions.followPointer,p&&m&&!p.isHidden&&(m=p.getAnchor([{}],c),p.updatePosition({plotX:m[0],plotY:m[1]})));this.unDocMouseMove||(this.unDocMouseMove=B(f,
"mousemove",function(b){if(H[a.hoverChartIndex])H[a.hoverChartIndex].pointer.onDocumentMouseMove(b)}));u(e?q:[b(t,q[0])],function(a){u(d.axes,function(b){(!a||a.series&&a.series[b.coll]===b)&&b.drawCrosshair(c,a)})})},reset:function(a,b){var c=this.chart,d=c.hoverSeries,e=c.hoverPoint,n=c.hoverPoints,m=c.tooltip,f=m&&m.shared?n:e;a&&f&&u(C(f),function(b){b.series.isCartesian&&void 0===b.plotX&&(a=!1)});if(a)m&&f&&(m.refresh(f),e&&(e.setState(e.state,!0),u(c.axes,function(a){a.crosshair&&a.drawCrosshair(null,
e)})));else{if(e)e.onMouseOut();n&&u(n,function(a){a.setState()});if(d)d.onMouseOut();m&&m.hide(b);this.unDocMouseMove&&(this.unDocMouseMove=this.unDocMouseMove());u(c.axes,function(a){a.hideCrosshair()});this.hoverX=this.prevKDPoint=c.hoverPoints=c.hoverPoint=null}},scaleGroups:function(a,b){var c=this.chart,d;u(c.series,function(e){d=a||e.getPlotBox();e.xAxis&&e.xAxis.zoomEnabled&&e.group&&(e.group.attr(d),e.markerGroup&&(e.markerGroup.attr(d),e.markerGroup.clip(b?c.clipRect:null)),e.dataLabelsGroup&&
e.dataLabelsGroup.attr(d))});c.clipRect.attr(b||c.clipBox)},dragStart:function(a){var b=this.chart;b.mouseIsDown=a.type;b.cancelClick=!1;b.mouseDownX=this.mouseDownX=a.chartX;b.mouseDownY=this.mouseDownY=a.chartY},drag:function(a){var b=this.chart,c=b.options.chart,d=a.chartX,e=a.chartY,m=this.zoomHor,f=this.zoomVert,p=b.plotLeft,h=b.plotTop,y=b.plotWidth,g=b.plotHeight,t,q=this.selectionMarker,k=this.mouseDownX,l=this.mouseDownY,r=c.panKey&&a[c.panKey+"Key"];q&&q.touch||(d<p?d=p:d>p+y&&(d=p+y),e<
h?e=h:e>h+g&&(e=h+g),this.hasDragged=Math.sqrt(Math.pow(k-d,2)+Math.pow(l-e,2)),10<this.hasDragged&&(t=b.isInsidePlot(k-p,l-h),b.hasCartesianSeries&&(this.zoomX||this.zoomY)&&t&&!r&&!q&&(this.selectionMarker=q=b.renderer.rect(p,h,m?1:y,f?1:g,0).attr({fill:c.selectionMarkerFill||G("#335cad").setOpacity(.25).get(),"class":"highcharts-selection-marker",zIndex:7}).add()),q&&m&&(d-=k,q.attr({width:Math.abs(d),x:(0<d?0:d)+k})),q&&f&&(d=e-l,q.attr({height:Math.abs(d),y:(0<d?0:d)+l})),t&&!q&&c.panning&&b.pan(a,
c.panning)))},drop:function(a){var b=this,c=this.chart,d=this.hasPinched;if(this.selectionMarker){var e={originalEvent:a,xAxis:[],yAxis:[]},m=this.selectionMarker,f=m.attr?m.attr("x"):m.x,p=m.attr?m.attr("y"):m.y,h=m.attr?m.attr("width"):m.width,y=m.attr?m.attr("height"):m.height,t;if(this.hasDragged||d)u(c.axes,function(c){if(c.zoomEnabled&&g(c.min)&&(d||b[{xAxis:"zoomX",yAxis:"zoomY"}[c.coll]])){var m=c.horiz,k="touchend"===a.type?c.minPixelPadding:0,n=c.toValue((m?f:p)+k),m=c.toValue((m?f+h:p+
y)-k);e[c.coll].push({axis:c,min:Math.min(n,m),max:Math.max(n,m)});t=!0}}),t&&q(c,"selection",e,function(a){c.zoom(l(a,d?{animation:!1}:null))});this.selectionMarker=this.selectionMarker.destroy();d&&this.scaleGroups()}c&&(r(c.container,{cursor:c._cursor}),c.cancelClick=10<this.hasDragged,c.mouseIsDown=this.hasDragged=this.hasPinched=!1,this.pinchDown=[])},onContainerMouseDown:function(a){a=this.normalize(a);this.zoomOption(a);a.preventDefault&&a.preventDefault();this.dragStart(a)},onDocumentMouseUp:function(b){H[a.hoverChartIndex]&&
H[a.hoverChartIndex].pointer.drop(b)},onDocumentMouseMove:function(a){var b=this.chart,c=this.chartPosition;a=this.normalize(a,c);!c||this.inClass(a.target,"highcharts-tracker")||b.isInsidePlot(a.chartX-b.plotLeft,a.chartY-b.plotTop)||this.reset()},onContainerMouseLeave:function(b){var c=H[a.hoverChartIndex];c&&(b.relatedTarget||b.toElement)&&(c.pointer.reset(),c.pointer.chartPosition=null)},onContainerMouseMove:function(b){var c=this.chart;g(a.hoverChartIndex)&&H[a.hoverChartIndex]&&H[a.hoverChartIndex].mouseIsDown||
(a.hoverChartIndex=c.index);b=this.normalize(b);b.returnValue=!1;"mousedown"===c.mouseIsDown&&this.drag(b);!this.inClass(b.target,"highcharts-tracker")&&!c.isInsidePlot(b.chartX-c.plotLeft,b.chartY-c.plotTop)||c.openMenu||this.runPointActions(b)},inClass:function(a,b){for(var c;a;){if(c=A(a,"class")){if(-1!==c.indexOf(b))return!0;if(-1!==c.indexOf("highcharts-container"))return!1}a=a.parentNode}},onTrackerMouseOut:function(a){var b=this.chart.hoverSeries;a=a.relatedTarget||a.toElement;if(!(!b||!a||
b.options.stickyTracking||this.inClass(a,"highcharts-tooltip")||this.inClass(a,"highcharts-series-"+b.index)&&this.inClass(a,"highcharts-tracker")))b.onMouseOut()},onContainerClick:function(a){var b=this.chart,c=b.hoverPoint,d=b.plotLeft,e=b.plotTop;a=this.normalize(a);b.cancelClick||(c&&this.inClass(a.target,"highcharts-tracker")?(q(c.series,"click",l(a,{point:c})),b.hoverPoint&&c.firePointEvent("click",a)):(l(a,this.getCoordinates(a)),b.isInsidePlot(a.chartX-d,a.chartY-e)&&q(b,"click",a)))},setDOMEvents:function(){var b=
this,d=b.chart.container;d.onmousedown=function(a){b.onContainerMouseDown(a)};d.onmousemove=function(a){b.onContainerMouseMove(a)};d.onclick=function(a){b.onContainerClick(a)};B(d,"mouseleave",b.onContainerMouseLeave);1===a.chartCount&&B(f,"mouseup",b.onDocumentMouseUp);a.hasTouch&&(d.ontouchstart=function(a){b.onContainerTouchStart(a)},d.ontouchmove=function(a){b.onContainerTouchMove(a)},1===a.chartCount&&B(f,"touchend",b.onDocumentTouchEnd))},destroy:function(){var b;p(this.chart.container,"mouseleave",
this.onContainerMouseLeave);a.chartCount||(p(f,"mouseup",this.onDocumentMouseUp),p(f,"touchend",this.onDocumentTouchEnd));clearInterval(this.tooltipTimeout);for(b in this)this[b]=null}}})(L);(function(a){var B=a.charts,A=a.each,H=a.extend,G=a.map,r=a.noop,g=a.pick;H(a.Pointer.prototype,{pinchTranslate:function(a,g,l,q,d,b){this.zoomHor&&this.pinchTranslateDirection(!0,a,g,l,q,d,b);this.zoomVert&&this.pinchTranslateDirection(!1,a,g,l,q,d,b)},pinchTranslateDirection:function(a,g,l,q,d,b,p,r){var f=
this.chart,m=a?"x":"y",c=a?"X":"Y",n="chart"+c,E=a?"width":"height",z=f["plot"+(a?"Left":"Top")],e,x,F=r||1,w=f.inverted,h=f.bounds[a?"h":"v"],y=1===g.length,J=g[0][n],u=l[0][n],I=!y&&g[1][n],k=!y&&l[1][n],D;l=function(){!y&&20<Math.abs(J-I)&&(F=r||Math.abs(u-k)/Math.abs(J-I));x=(z-u)/F+J;e=f["plot"+(a?"Width":"Height")]/F};l();g=x;g<h.min?(g=h.min,D=!0):g+e>h.max&&(g=h.max-e,D=!0);D?(u-=.8*(u-p[m][0]),y||(k-=.8*(k-p[m][1])),l()):p[m]=[u,k];w||(b[m]=x-z,b[E]=e);b=w?1/F:F;d[E]=e;d[m]=g;q[w?a?"scaleY":
"scaleX":"scale"+c]=F;q["translate"+c]=b*z+(u-b*J)},pinch:function(a){var f=this,l=f.chart,q=f.pinchDown,d=a.touches,b=d.length,p=f.lastValidTouch,C=f.hasZoom,t=f.selectionMarker,m={},c=1===b&&(f.inClass(a.target,"highcharts-tracker")&&l.runTrackerClick||f.runChartClick),n={};1<b&&(f.initiated=!0);C&&f.initiated&&!c&&a.preventDefault();G(d,function(a){return f.normalize(a)});"touchstart"===a.type?(A(d,function(a,b){q[b]={chartX:a.chartX,chartY:a.chartY}}),p.x=[q[0].chartX,q[1]&&q[1].chartX],p.y=[q[0].chartY,
q[1]&&q[1].chartY],A(l.axes,function(a){if(a.zoomEnabled){var b=l.bounds[a.horiz?"h":"v"],c=a.minPixelPadding,d=a.toPixels(g(a.options.min,a.dataMin)),m=a.toPixels(g(a.options.max,a.dataMax)),f=Math.max(d,m);b.min=Math.min(a.pos,Math.min(d,m)-c);b.max=Math.max(a.pos+a.len,f+c)}}),f.res=!0):f.followTouchMove&&1===b?this.runPointActions(f.normalize(a)):q.length&&(t||(f.selectionMarker=t=H({destroy:r,touch:!0},l.plotBox)),f.pinchTranslate(q,d,m,t,n,p),f.hasPinched=C,f.scaleGroups(m,n),f.res&&(f.res=
!1,this.reset(!1,0)))},touch:function(f,r){var l=this.chart,q,d;if(l.index!==a.hoverChartIndex)this.onContainerMouseLeave({relatedTarget:!0});a.hoverChartIndex=l.index;1===f.touches.length?(f=this.normalize(f),(d=l.isInsidePlot(f.chartX-l.plotLeft,f.chartY-l.plotTop))&&!l.openMenu?(r&&this.runPointActions(f),"touchmove"===f.type&&(r=this.pinchDown,q=r[0]?4<=Math.sqrt(Math.pow(r[0].chartX-f.chartX,2)+Math.pow(r[0].chartY-f.chartY,2)):!1),g(q,!0)&&this.pinch(f)):r&&this.reset()):2===f.touches.length&&
this.pinch(f)},onContainerTouchStart:function(a){this.zoomOption(a);this.touch(a,!0)},onContainerTouchMove:function(a){this.touch(a)},onDocumentTouchEnd:function(f){B[a.hoverChartIndex]&&B[a.hoverChartIndex].pointer.drop(f)}})})(L);(function(a){var B=a.addEvent,A=a.charts,H=a.css,G=a.doc,r=a.extend,g=a.noop,f=a.Pointer,u=a.removeEvent,l=a.win,q=a.wrap;if(l.PointerEvent||l.MSPointerEvent){var d={},b=!!l.PointerEvent,p=function(){var a,b=[];b.item=function(a){return this[a]};for(a in d)d.hasOwnProperty(a)&&
b.push({pageX:d[a].pageX,pageY:d[a].pageY,target:d[a].target});return b},C=function(b,d,c,f){"touch"!==b.pointerType&&b.pointerType!==b.MSPOINTER_TYPE_TOUCH||!A[a.hoverChartIndex]||(f(b),f=A[a.hoverChartIndex].pointer,f[d]({type:c,target:b.currentTarget,preventDefault:g,touches:p()}))};r(f.prototype,{onContainerPointerDown:function(a){C(a,"onContainerTouchStart","touchstart",function(a){d[a.pointerId]={pageX:a.pageX,pageY:a.pageY,target:a.currentTarget}})},onContainerPointerMove:function(a){C(a,"onContainerTouchMove",
"touchmove",function(a){d[a.pointerId]={pageX:a.pageX,pageY:a.pageY};d[a.pointerId].target||(d[a.pointerId].target=a.currentTarget)})},onDocumentPointerUp:function(a){C(a,"onDocumentTouchEnd","touchend",function(a){delete d[a.pointerId]})},batchMSEvents:function(a){a(this.chart.container,b?"pointerdown":"MSPointerDown",this.onContainerPointerDown);a(this.chart.container,b?"pointermove":"MSPointerMove",this.onContainerPointerMove);a(G,b?"pointerup":"MSPointerUp",this.onDocumentPointerUp)}});q(f.prototype,
"init",function(a,b,c){a.call(this,b,c);this.hasZoom&&H(b.container,{"-ms-touch-action":"none","touch-action":"none"})});q(f.prototype,"setDOMEvents",function(a){a.apply(this);(this.hasZoom||this.followTouchMove)&&this.batchMSEvents(B)});q(f.prototype,"destroy",function(a){this.batchMSEvents(u);a.call(this)})}})(L);(function(a){var B,A=a.addEvent,H=a.css,G=a.discardElement,r=a.defined,g=a.each,f=a.extend,u=a.isFirefox,l=a.marginNames,q=a.merge,d=a.pick,b=a.setAnimation,p=a.stableSort,C=a.win,t=a.wrap;
B=a.Legend=function(a,b){this.init(a,b)};B.prototype={init:function(a,b){this.chart=a;this.setOptions(b);b.enabled&&(this.render(),A(this.chart,"endResize",function(){this.legend.positionCheckboxes()}))},setOptions:function(a){var b=d(a.padding,8);this.options=a;this.itemStyle=a.itemStyle;this.itemHiddenStyle=q(this.itemStyle,a.itemHiddenStyle);this.itemMarginTop=a.itemMarginTop||0;this.initialItemX=this.padding=b;this.initialItemY=b-5;this.itemHeight=this.maxItemWidth=0;this.symbolWidth=d(a.symbolWidth,
16);this.pages=[]},update:function(a,b){var c=this.chart;this.setOptions(q(!0,this.options,a));this.destroy();c.isDirtyLegend=c.isDirtyBox=!0;d(b,!0)&&c.redraw()},colorizeItem:function(a,b){a.legendGroup[b?"removeClass":"addClass"]("highcharts-legend-item-hidden");var c=this.options,d=a.legendItem,m=a.legendLine,e=a.legendSymbol,f=this.itemHiddenStyle.color,c=b?c.itemStyle.color:f,p=b?a.color||f:f,g=a.options&&a.options.marker,h={fill:p},y;d&&d.css({fill:c,color:c});m&&m.attr({stroke:p});if(e){if(g&&
e.isMarker&&(h=a.pointAttribs(),!b))for(y in h)h[y]=f;e.attr(h)}},positionItem:function(a){var b=this.options,d=b.symbolPadding,b=!b.rtl,m=a._legendItemPos,f=m[0],m=m[1],e=a.checkbox;(a=a.legendGroup)&&a.element&&a.translate(b?f:this.legendWidth-f-2*d-4,m);e&&(e.x=f,e.y=m)},destroyItem:function(a){var b=a.checkbox;g(["legendItem","legendLine","legendSymbol","legendGroup"],function(b){a[b]&&(a[b]=a[b].destroy())});b&&G(a.checkbox)},destroy:function(){function a(a){this[a]&&(this[a]=this[a].destroy())}
g(this.getAllItems(),function(b){g(["legendItem","legendGroup"],a,b)});g(["box","title","group"],a,this);this.display=null},positionCheckboxes:function(a){var b=this.group&&this.group.alignAttr,d,m=this.clipHeight||this.legendHeight,f=this.titleHeight;b&&(d=b.translateY,g(this.allItems,function(c){var e=c.checkbox,n;e&&(n=d+f+e.y+(a||0)+3,H(e,{left:b.translateX+c.checkboxOffset+e.x-20+"px",top:n+"px",display:n>d-6&&n<d+m-6?"":"none"}))}))},renderTitle:function(){var a=this.padding,b=this.options.title,
d=0;b.text&&(this.title||(this.title=this.chart.renderer.label(b.text,a-3,a-4,null,null,null,null,null,"legend-title").attr({zIndex:1}).css(b.style).add(this.group)),a=this.title.getBBox(),d=a.height,this.offsetWidth=a.width,this.contentGroup.attr({translateY:d}));this.titleHeight=d},setText:function(b){var c=this.options;b.legendItem.attr({text:c.labelFormat?a.format(c.labelFormat,b):c.labelFormatter.call(b)})},renderItem:function(a){var b=this.chart,f=b.renderer,m=this.options,p="horizontal"===
m.layout,e=this.symbolWidth,g=m.symbolPadding,l=this.itemStyle,t=this.itemHiddenStyle,h=this.padding,y=p?d(m.itemDistance,20):0,J=!m.rtl,r=m.width,I=m.itemMarginBottom||0,k=this.itemMarginTop,u=this.initialItemX,C=a.legendItem,N=!a.series,A=!N&&a.series.drawLegendSymbol?a.series:a,B=A.options,B=this.createCheckboxForItem&&B&&B.showCheckbox,v=m.useHTML;C||(a.legendGroup=f.g("legend-item").addClass("highcharts-"+A.type+"-series highcharts-color-"+a.colorIndex+(a.options.className?" "+a.options.className:
"")+(N?" highcharts-series-"+a.index:"")).attr({zIndex:1}).add(this.scrollGroup),a.legendItem=C=f.text("",J?e+g:-g,this.baseline||0,v).css(q(a.visible?l:t)).attr({align:J?"left":"right",zIndex:2}).add(a.legendGroup),this.baseline||(l=l.fontSize,this.fontMetrics=f.fontMetrics(l,C),this.baseline=this.fontMetrics.f+3+k,C.attr("y",this.baseline)),this.symbolHeight=m.symbolHeight||this.fontMetrics.f,A.drawLegendSymbol(this,a),this.setItemEvents&&this.setItemEvents(a,C,v),B&&this.createCheckboxForItem(a));
this.colorizeItem(a,a.visible);this.setText(a);f=C.getBBox();e=a.checkboxOffset=m.itemWidth||a.legendItemWidth||e+g+f.width+y+(B?20:0);this.itemHeight=g=Math.round(a.legendItemHeight||f.height);p&&this.itemX-u+e>(r||b.chartWidth-2*h-u-m.x)&&(this.itemX=u,this.itemY+=k+this.lastLineHeight+I,this.lastLineHeight=0);this.maxItemWidth=Math.max(this.maxItemWidth,e);this.lastItemY=k+this.itemY+I;this.lastLineHeight=Math.max(g,this.lastLineHeight);a._legendItemPos=[this.itemX,this.itemY];p?this.itemX+=e:
(this.itemY+=k+g+I,this.lastLineHeight=g);this.offsetWidth=r||Math.max((p?this.itemX-u-y:e)+h,this.offsetWidth)},getAllItems:function(){var a=[];g(this.chart.series,function(b){var c=b&&b.options;b&&d(c.showInLegend,r(c.linkedTo)?!1:void 0,!0)&&(a=a.concat(b.legendItems||("point"===c.legendType?b.data:b)))});return a},adjustMargins:function(a,b){var c=this.chart,f=this.options,m=f.align.charAt(0)+f.verticalAlign.charAt(0)+f.layout.charAt(0);f.floating||g([/(lth|ct|rth)/,/(rtv|rm|rbv)/,/(rbh|cb|lbh)/,
/(lbv|lm|ltv)/],function(e,n){e.test(m)&&!r(a[n])&&(c[l[n]]=Math.max(c[l[n]],c.legend[(n+1)%2?"legendHeight":"legendWidth"]+[1,-1,-1,1][n]*f[n%2?"x":"y"]+d(f.margin,12)+b[n]))})},render:function(){var a=this,b=a.chart,d=b.renderer,q=a.group,l,e,t,r,w=a.box,h=a.options,y=a.padding;a.itemX=a.initialItemX;a.itemY=a.initialItemY;a.offsetWidth=0;a.lastItemY=0;q||(a.group=q=d.g("legend").attr({zIndex:7}).add(),a.contentGroup=d.g().attr({zIndex:1}).add(q),a.scrollGroup=d.g().add(a.contentGroup));a.renderTitle();
l=a.getAllItems();p(l,function(a,b){return(a.options&&a.options.legendIndex||0)-(b.options&&b.options.legendIndex||0)});h.reversed&&l.reverse();a.allItems=l;a.display=e=!!l.length;a.lastLineHeight=0;g(l,function(b){a.renderItem(b)});t=(h.width||a.offsetWidth)+y;r=a.lastItemY+a.lastLineHeight+a.titleHeight;r=a.handleOverflow(r);r+=y;w||(a.box=w=d.rect().addClass("highcharts-legend-box").attr({r:h.borderRadius}).add(q),w.isNew=!0);w.attr({stroke:h.borderColor,"stroke-width":h.borderWidth||0,fill:h.backgroundColor||
"none"}).shadow(h.shadow);0<t&&0<r&&(w[w.isNew?"attr":"animate"](w.crisp({x:0,y:0,width:t,height:r},w.strokeWidth())),w.isNew=!1);w[e?"show":"hide"]();a.legendWidth=t;a.legendHeight=r;g(l,function(b){a.positionItem(b)});e&&q.align(f({width:t,height:r},h),!0,"spacingBox");b.isResizing||this.positionCheckboxes()},handleOverflow:function(a){var b=this,f=this.chart,m=f.renderer,p=this.options,e=p.y,f=f.spacingBox.height+("top"===p.verticalAlign?-e:e)-this.padding,e=p.maxHeight,q,l=this.clipRect,t=p.navigation,
h=d(t.animation,!0),y=t.arrowSize||12,r=this.nav,u=this.pages,I=this.padding,k,D=this.allItems,C=function(a){a?l.attr({height:a}):l&&(b.clipRect=l.destroy(),b.contentGroup.clip());b.contentGroup.div&&(b.contentGroup.div.style.clip=a?"rect("+I+"px,9999px,"+(I+a)+"px,0)":"auto")};"horizontal"!==p.layout||"middle"===p.verticalAlign||p.floating||(f/=2);e&&(f=Math.min(f,e));u.length=0;a>f&&!1!==t.enabled?(this.clipHeight=q=Math.max(f-20-this.titleHeight-I,0),this.currentPage=d(this.currentPage,1),this.fullHeight=
a,g(D,function(a,b){var c=a._legendItemPos[1];a=Math.round(a.legendItem.getBBox().height);var e=u.length;if(!e||c-u[e-1]>q&&(k||c)!==u[e-1])u.push(k||c),e++;b===D.length-1&&c+a-u[e-1]>q&&u.push(c);c!==k&&(k=c)}),l||(l=b.clipRect=m.clipRect(0,I,9999,0),b.contentGroup.clip(l)),C(q),r||(this.nav=r=m.g().attr({zIndex:1}).add(this.group),this.up=m.symbol("triangle",0,0,y,y).on("click",function(){b.scroll(-1,h)}).add(r),this.pager=m.text("",15,10).addClass("highcharts-legend-navigation").css(t.style).add(r),
this.down=m.symbol("triangle-down",0,0,y,y).on("click",function(){b.scroll(1,h)}).add(r)),b.scroll(0),a=f):r&&(C(),r.hide(),this.scrollGroup.attr({translateY:1}),this.clipHeight=0);return a},scroll:function(a,c){var d=this.pages,f=d.length;a=this.currentPage+a;var m=this.clipHeight,e=this.options.navigation,p=this.pager,g=this.padding;a>f&&(a=f);0<a&&(void 0!==c&&b(c,this.chart),this.nav.attr({translateX:g,translateY:m+this.padding+7+this.titleHeight,visibility:"visible"}),this.up.attr({"class":1===
a?"highcharts-legend-nav-inactive":"highcharts-legend-nav-active"}),p.attr({text:a+"/"+f}),this.down.attr({x:18+this.pager.getBBox().width,"class":a===f?"highcharts-legend-nav-inactive":"highcharts-legend-nav-active"}),this.up.attr({fill:1===a?e.inactiveColor:e.activeColor}).css({cursor:1===a?"default":"pointer"}),this.down.attr({fill:a===f?e.inactiveColor:e.activeColor}).css({cursor:a===f?"default":"pointer"}),c=-d[a-1]+this.initialItemY,this.scrollGroup.animate({translateY:c}),this.currentPage=
a,this.positionCheckboxes(c))}};a.LegendSymbolMixin={drawRectangle:function(a,b){var c=a.symbolHeight,f=a.options.squareSymbol;b.legendSymbol=this.chart.renderer.rect(f?(a.symbolWidth-c)/2:0,a.baseline-c+1,f?c:a.symbolWidth,c,d(a.options.symbolRadius,c/2)).addClass("highcharts-point").attr({zIndex:3}).add(b.legendGroup)},drawLineMarker:function(a){var b=this.options,f=b.marker,m=a.symbolWidth,p=a.symbolHeight,e=p/2,g=this.chart.renderer,l=this.legendGroup;a=a.baseline-Math.round(.3*a.fontMetrics.b);
var t;t={"stroke-width":b.lineWidth||0};b.dashStyle&&(t.dashstyle=b.dashStyle);this.legendLine=g.path(["M",0,a,"L",m,a]).addClass("highcharts-graph").attr(t).add(l);f&&!1!==f.enabled&&(b=Math.min(d(f.radius,e),e),0===this.symbol.indexOf("url")&&(f=q(f,{width:p,height:p}),b=0),this.legendSymbol=f=g.symbol(this.symbol,m/2-b,a-b,2*b,2*b,f).addClass("highcharts-point").add(l),f.isMarker=!0)}};(/Trident\/7\.0/.test(C.navigator.userAgent)||u)&&t(B.prototype,"positionItem",function(a,b){var c=this,d=function(){b._legendItemPos&&
a.call(c,b)};d();setTimeout(d)})})(L);(function(a){var B=a.addEvent,A=a.animate,H=a.animObject,G=a.attr,r=a.doc,g=a.Axis,f=a.createElement,u=a.defaultOptions,l=a.discardElement,q=a.charts,d=a.css,b=a.defined,p=a.each,C=a.extend,t=a.find,m=a.fireEvent,c=a.getStyle,n=a.grep,E=a.isNumber,z=a.isObject,e=a.isString,x=a.Legend,F=a.marginNames,w=a.merge,h=a.Pointer,y=a.pick,J=a.pInt,K=a.removeEvent,I=a.seriesTypes,k=a.splat,D=a.svg,P=a.syncTimeout,N=a.win,S=a.Renderer,O=a.Chart=function(){this.getArgs.apply(this,
arguments)};a.chart=function(a,b,c){return new O(a,b,c)};O.prototype={callbacks:[],getArgs:function(){var a=[].slice.call(arguments);if(e(a[0])||a[0].nodeName)this.renderTo=a.shift();this.init(a[0],a[1])},init:function(b,c){var e,h=b.series;b.series=null;e=w(u,b);e.series=b.series=h;this.userOptions=b;this.respRules=[];b=e.chart;h=b.events;this.margin=[];this.spacing=[];this.bounds={h:{},v:{}};this.callback=c;this.isResizing=0;this.options=e;this.axes=[];this.series=[];this.hasCartesianSeries=b.showAxes;
var d;this.index=q.length;q.push(this);a.chartCount++;if(h)for(d in h)B(this,d,h[d]);this.xAxis=[];this.yAxis=[];this.pointCount=this.colorCounter=this.symbolCounter=0;this.firstRender()},initSeries:function(b){var c=this.options.chart;(c=I[b.type||c.type||c.defaultSeriesType])||a.error(17,!0);c=new c;c.init(this,b);return c},orderSeries:function(a){var b=this.series;for(a=a||0;a<b.length;a++)b[a]&&(b[a].index=a,b[a].name=b[a].name||"Series "+(b[a].index+1))},isInsidePlot:function(a,b,c){var e=c?
b:a;a=c?a:b;return 0<=e&&e<=this.plotWidth&&0<=a&&a<=this.plotHeight},redraw:function(b){var c=this.axes,e=this.series,h=this.pointer,d=this.legend,k=this.isDirtyLegend,f,n,y=this.hasCartesianSeries,g=this.isDirtyBox,v=e.length,l=v,q=this.renderer,t=q.isHidden(),w=[];this.setResponsive&&this.setResponsive(!1);a.setAnimation(b,this);t&&this.cloneRenderTo();for(this.layOutTitles();l--;)if(b=e[l],b.options.stacking&&(f=!0,b.isDirty)){n=!0;break}if(n)for(l=v;l--;)b=e[l],b.options.stacking&&(b.isDirty=
!0);p(e,function(a){a.isDirty&&"point"===a.options.legendType&&(a.updateTotals&&a.updateTotals(),k=!0);a.isDirtyData&&m(a,"updatedData")});k&&d.options.enabled&&(d.render(),this.isDirtyLegend=!1);f&&this.getStacks();y&&p(c,function(a){a.updateNames();a.setScale()});this.getMargins();y&&(p(c,function(a){a.isDirty&&(g=!0)}),p(c,function(a){var b=a.min+","+a.max;a.extKey!==b&&(a.extKey=b,w.push(function(){m(a,"afterSetExtremes",C(a.eventArgs,a.getExtremes()));delete a.eventArgs}));(g||f)&&a.redraw()}));
g&&this.drawChartBox();m(this,"predraw");p(e,function(a){(g||a.isDirty)&&a.visible&&a.redraw();a.isDirtyData=!1});h&&h.reset(!0);q.draw();m(this,"redraw");m(this,"render");t&&this.cloneRenderTo(!0);p(w,function(a){a.call()})},get:function(a){function b(b){return b.id===a||b.options&&b.options.id===a}var c,e=this.series,h;c=t(this.axes,b)||t(this.series,b);for(h=0;!c&&h<e.length;h++)c=t(e[h].points||[],b);return c},getAxes:function(){var a=this,b=this.options,c=b.xAxis=k(b.xAxis||{}),b=b.yAxis=k(b.yAxis||
{});p(c,function(a,b){a.index=b;a.isX=!0});p(b,function(a,b){a.index=b});c=c.concat(b);p(c,function(b){new g(a,b)})},getSelectedPoints:function(){var a=[];p(this.series,function(b){a=a.concat(n(b.points||[],function(a){return a.selected}))});return a},getSelectedSeries:function(){return n(this.series,function(a){return a.selected})},setTitle:function(a,b,c){var e=this,h=e.options,d;d=h.title=w({style:{color:"#333333",fontSize:h.isStock?"16px":"18px"}},h.title,a);h=h.subtitle=w({style:{color:"#666666"}},
h.subtitle,b);p([["title",a,d],["subtitle",b,h]],function(a,b){var c=a[0],h=e[c],d=a[1];a=a[2];h&&d&&(e[c]=h=h.destroy());a&&a.text&&!h&&(e[c]=e.renderer.text(a.text,0,0,a.useHTML).attr({align:a.align,"class":"highcharts-"+c,zIndex:a.zIndex||4}).add(),e[c].update=function(a){e.setTitle(!b&&a,b&&a)},e[c].css(a.style))});e.layOutTitles(c)},layOutTitles:function(a){var b=0,c,e=this.renderer,h=this.spacingBox;p(["title","subtitle"],function(a){var c=this[a],d=this.options[a],k;c&&(k=d.style.fontSize,
k=e.fontMetrics(k,c).b,c.css({width:(d.width||h.width+d.widthAdjust)+"px"}).align(C({y:b+k+("title"===a?-3:2)},d),!1,"spacingBox"),d.floating||d.verticalAlign||(b=Math.ceil(b+c.getBBox().height)))},this);c=this.titleOffset!==b;this.titleOffset=b;!this.isDirtyBox&&c&&(this.isDirtyBox=c,this.hasRendered&&y(a,!0)&&this.isDirtyBox&&this.redraw())},getChartSize:function(){var a=this.options.chart,e=a.width,a=a.height,h=this.renderToClone||this.renderTo;b(e)||(this.containerWidth=c(h,"width"));b(a)||(this.containerHeight=
c(h,"height"));this.chartWidth=Math.max(0,e||this.containerWidth||600);this.chartHeight=Math.max(0,a||this.containerHeight||400)},cloneRenderTo:function(a){var b=this.renderToClone,c=this.container;if(a){if(b){for(;b.childNodes.length;)this.renderTo.appendChild(b.firstChild);l(b);delete this.renderToClone}}else c&&c.parentNode===this.renderTo&&this.renderTo.removeChild(c),this.renderToClone=b=this.renderTo.cloneNode(0),d(b,{position:"absolute",top:"-9999px",display:"block"}),b.style.setProperty&&
b.style.setProperty("display","block","important"),r.body.appendChild(b),c&&b.appendChild(c)},setClassName:function(a){this.container.className="highcharts-container "+(a||"")},getContainer:function(){var b,c=this.options,h=c.chart,d,k;b=this.renderTo;var m=a.uniqueKey(),n;b||(this.renderTo=b=h.renderTo);e(b)&&(this.renderTo=b=r.getElementById(b));b||a.error(13,!0);d=J(G(b,"data-highcharts-chart"));E(d)&&q[d]&&q[d].hasRendered&&q[d].destroy();G(b,"data-highcharts-chart",this.index);b.innerHTML="";
h.skipClone||b.offsetWidth||this.cloneRenderTo();this.getChartSize();d=this.chartWidth;k=this.chartHeight;n=C({position:"relative",overflow:"hidden",width:d+"px",height:k+"px",textAlign:"left",lineHeight:"normal",zIndex:0,"-webkit-tap-highlight-color":"rgba(0,0,0,0)"},h.style);this.container=b=f("div",{id:m},n,this.renderToClone||b);this._cursor=b.style.cursor;this.renderer=new (a[h.renderer]||S)(b,d,k,null,h.forExport,c.exporting&&c.exporting.allowHTML);this.setClassName(h.className);this.renderer.setStyle(h.style);
this.renderer.chartIndex=this.index},getMargins:function(a){var c=this.spacing,e=this.margin,h=this.titleOffset;this.resetMargins();h&&!b(e[0])&&(this.plotTop=Math.max(this.plotTop,h+this.options.title.margin+c[0]));this.legend.display&&this.legend.adjustMargins(e,c);this.extraMargin&&(this[this.extraMargin.type]=(this[this.extraMargin.type]||0)+this.extraMargin.value);this.extraTopMargin&&(this.plotTop+=this.extraTopMargin);a||this.getAxisMargins()},getAxisMargins:function(){var a=this,c=a.axisOffset=
[0,0,0,0],e=a.margin;a.hasCartesianSeries&&p(a.axes,function(a){a.visible&&a.getOffset()});p(F,function(h,d){b(e[d])||(a[h]+=c[d])});a.setChartSize()},reflow:function(a){var e=this,h=e.options.chart,d=e.renderTo,k=b(h.width),f=h.width||c(d,"width"),h=h.height||c(d,"height"),d=a?a.target:N;if(!k&&!e.isPrinting&&f&&h&&(d===N||d===r)){if(f!==e.containerWidth||h!==e.containerHeight)clearTimeout(e.reflowTimeout),e.reflowTimeout=P(function(){e.container&&e.setSize(void 0,void 0,!1)},a?100:0);e.containerWidth=
f;e.containerHeight=h}},initReflow:function(){var a=this,b;b=B(N,"resize",function(b){a.reflow(b)});B(a,"destroy",b)},setSize:function(b,c,e){var h=this,k=h.renderer;h.isResizing+=1;a.setAnimation(e,h);h.oldChartHeight=h.chartHeight;h.oldChartWidth=h.chartWidth;void 0!==b&&(h.options.chart.width=b);void 0!==c&&(h.options.chart.height=c);h.getChartSize();b=k.globalAnimation;(b?A:d)(h.container,{width:h.chartWidth+"px",height:h.chartHeight+"px"},b);h.setChartSize(!0);k.setSize(h.chartWidth,h.chartHeight,
e);p(h.axes,function(a){a.isDirty=!0;a.setScale()});h.isDirtyLegend=!0;h.isDirtyBox=!0;h.layOutTitles();h.getMargins();h.redraw(e);h.oldChartHeight=null;m(h,"resize");P(function(){h&&m(h,"endResize",null,function(){--h.isResizing})},H(b).duration)},setChartSize:function(a){var b=this.inverted,c=this.renderer,e=this.chartWidth,h=this.chartHeight,d=this.options.chart,k=this.spacing,f=this.clipOffset,m,n,y,g;this.plotLeft=m=Math.round(this.plotLeft);this.plotTop=n=Math.round(this.plotTop);this.plotWidth=
y=Math.max(0,Math.round(e-m-this.marginRight));this.plotHeight=g=Math.max(0,Math.round(h-n-this.marginBottom));this.plotSizeX=b?g:y;this.plotSizeY=b?y:g;this.plotBorderWidth=d.plotBorderWidth||0;this.spacingBox=c.spacingBox={x:k[3],y:k[0],width:e-k[3]-k[1],height:h-k[0]-k[2]};this.plotBox=c.plotBox={x:m,y:n,width:y,height:g};e=2*Math.floor(this.plotBorderWidth/2);b=Math.ceil(Math.max(e,f[3])/2);c=Math.ceil(Math.max(e,f[0])/2);this.clipBox={x:b,y:c,width:Math.floor(this.plotSizeX-Math.max(e,f[1])/
2-b),height:Math.max(0,Math.floor(this.plotSizeY-Math.max(e,f[2])/2-c))};a||p(this.axes,function(a){a.setAxisSize();a.setAxisTranslation()})},resetMargins:function(){var a=this,b=a.options.chart;p(["margin","spacing"],function(c){var e=b[c],h=z(e)?e:[e,e,e,e];p(["Top","Right","Bottom","Left"],function(e,d){a[c][d]=y(b[c+e],h[d])})});p(F,function(b,c){a[b]=y(a.margin[c],a.spacing[c])});a.axisOffset=[0,0,0,0];a.clipOffset=[0,0,0,0]},drawChartBox:function(){var a=this.options.chart,b=this.renderer,c=
this.chartWidth,e=this.chartHeight,h=this.chartBackground,d=this.plotBackground,k=this.plotBorder,f,m=this.plotBGImage,n=a.backgroundColor,p=a.plotBackgroundColor,y=a.plotBackgroundImage,g,l=this.plotLeft,q=this.plotTop,t=this.plotWidth,w=this.plotHeight,x=this.plotBox,r=this.clipRect,z=this.clipBox,J="animate";h||(this.chartBackground=h=b.rect().addClass("highcharts-background").add(),J="attr");f=a.borderWidth||0;g=f+(a.shadow?8:0);n={fill:n||"none"};if(f||h["stroke-width"])n.stroke=a.borderColor,
n["stroke-width"]=f;h.attr(n).shadow(a.shadow);h[J]({x:g/2,y:g/2,width:c-g-f%2,height:e-g-f%2,r:a.borderRadius});J="animate";d||(J="attr",this.plotBackground=d=b.rect().addClass("highcharts-plot-background").add());d[J](x);d.attr({fill:p||"none"}).shadow(a.plotShadow);y&&(m?m.animate(x):this.plotBGImage=b.image(y,l,q,t,w).add());r?r.animate({width:z.width,height:z.height}):this.clipRect=b.clipRect(z);J="animate";k||(J="attr",this.plotBorder=k=b.rect().addClass("highcharts-plot-border").attr({zIndex:1}).add());
k.attr({stroke:a.plotBorderColor,"stroke-width":a.plotBorderWidth||0,fill:"none"});k[J](k.crisp({x:l,y:q,width:t,height:w},-k.strokeWidth()));this.isDirtyBox=!1},propFromSeries:function(){var a=this,b=a.options.chart,c,e=a.options.series,h,d;p(["inverted","angular","polar"],function(k){c=I[b.type||b.defaultSeriesType];d=b[k]||c&&c.prototype[k];for(h=e&&e.length;!d&&h--;)(c=I[e[h].type])&&c.prototype[k]&&(d=!0);a[k]=d})},linkSeries:function(){var a=this,b=a.series;p(b,function(a){a.linkedSeries.length=
0});p(b,function(b){var c=b.options.linkedTo;e(c)&&(c=":previous"===c?a.series[b.index-1]:a.get(c))&&c.linkedParent!==b&&(c.linkedSeries.push(b),b.linkedParent=c,b.visible=y(b.options.visible,c.options.visible,b.visible))})},renderSeries:function(){p(this.series,function(a){a.translate();a.render()})},renderLabels:function(){var a=this,b=a.options.labels;b.items&&p(b.items,function(c){var e=C(b.style,c.style),h=J(e.left)+a.plotLeft,d=J(e.top)+a.plotTop+12;delete e.left;delete e.top;a.renderer.text(c.html,
h,d).attr({zIndex:2}).css(e).add()})},render:function(){var a=this.axes,b=this.renderer,c=this.options,e,h,d;this.setTitle();this.legend=new x(this,c.legend);this.getStacks&&this.getStacks();this.getMargins(!0);this.setChartSize();c=this.plotWidth;e=this.plotHeight-=21;p(a,function(a){a.setScale()});this.getAxisMargins();h=1.1<c/this.plotWidth;d=1.05<e/this.plotHeight;if(h||d)p(a,function(a){(a.horiz&&h||!a.horiz&&d)&&a.setTickInterval(!0)}),this.getMargins();this.drawChartBox();this.hasCartesianSeries&&
p(a,function(a){a.visible&&a.render()});this.seriesGroup||(this.seriesGroup=b.g("series-group").attr({zIndex:3}).add());this.renderSeries();this.renderLabels();this.addCredits();this.setResponsive&&this.setResponsive();this.hasRendered=!0},addCredits:function(a){var b=this;a=w(!0,this.options.credits,a);a.enabled&&!this.credits&&(this.credits=this.renderer.text(a.text+(this.mapCredits||""),0,0).addClass("highcharts-credits").on("click",function(){a.href&&(N.location.href=a.href)}).attr({align:a.position.align,
zIndex:8}).css(a.style).add().align(a.position),this.credits.update=function(a){b.credits=b.credits.destroy();b.addCredits(a)})},destroy:function(){var b=this,c=b.axes,e=b.series,h=b.container,d,k=h&&h.parentNode;m(b,"destroy");q[b.index]=void 0;a.chartCount--;b.renderTo.removeAttribute("data-highcharts-chart");K(b);for(d=c.length;d--;)c[d]=c[d].destroy();this.scroller&&this.scroller.destroy&&this.scroller.destroy();for(d=e.length;d--;)e[d]=e[d].destroy();p("title subtitle chartBackground plotBackground plotBGImage plotBorder seriesGroup clipRect credits pointer rangeSelector legend resetZoomButton tooltip renderer".split(" "),
function(a){var c=b[a];c&&c.destroy&&(b[a]=c.destroy())});h&&(h.innerHTML="",K(h),k&&l(h));for(d in b)delete b[d]},isReadyToRender:function(){var a=this;return D||N!=N.top||"complete"===r.readyState?!0:(r.attachEvent("onreadystatechange",function(){r.detachEvent("onreadystatechange",a.firstRender);"complete"===r.readyState&&a.firstRender()}),!1)},firstRender:function(){var a=this,b=a.options;if(a.isReadyToRender()){a.getContainer();m(a,"init");a.resetMargins();a.setChartSize();a.propFromSeries();
a.getAxes();p(b.series||[],function(b){a.initSeries(b)});a.linkSeries();m(a,"beforeRender");h&&(a.pointer=new h(a,b));a.render();if(!a.renderer.imgCount&&a.onload)a.onload();a.cloneRenderTo(!0)}},onload:function(){p([this.callback].concat(this.callbacks),function(a){a&&void 0!==this.index&&a.apply(this,[this])},this);m(this,"load");m(this,"render");b(this.index)&&!1!==this.options.chart.reflow&&this.initReflow();this.onload=null}}})(L);(function(a){var B,A=a.each,H=a.extend,G=a.erase,r=a.fireEvent,
g=a.format,f=a.isArray,u=a.isNumber,l=a.pick,q=a.removeEvent;B=a.Point=function(){};B.prototype={init:function(a,b,f){this.series=a;this.color=a.color;this.applyOptions(b,f);a.options.colorByPoint?(b=a.options.colors||a.chart.options.colors,this.color=this.color||b[a.colorCounter],b=b.length,f=a.colorCounter,a.colorCounter++,a.colorCounter===b&&(a.colorCounter=0)):f=a.colorIndex;this.colorIndex=l(this.colorIndex,f);a.chart.pointCount++;return this},applyOptions:function(a,b){var d=this.series,f=d.options.pointValKey||
d.pointValKey;a=B.prototype.optionsToObject.call(this,a);H(this,a);this.options=this.options?H(this.options,a):a;a.group&&delete this.group;f&&(this.y=this[f]);this.isNull=l(this.isValid&&!this.isValid(),null===this.x||!u(this.y,!0));this.selected&&(this.state="select");"name"in this&&void 0===b&&d.xAxis&&d.xAxis.hasNames&&(this.x=d.xAxis.nameToX(this));void 0===this.x&&d&&(this.x=void 0===b?d.autoIncrement(this):b);return this},optionsToObject:function(a){var b={},d=this.series,g=d.options.keys,
l=g||d.pointArrayMap||["y"],m=l.length,c=0,n=0;if(u(a)||null===a)b[l[0]]=a;else if(f(a))for(!g&&a.length>m&&(d=typeof a[0],"string"===d?b.name=a[0]:"number"===d&&(b.x=a[0]),c++);n<m;)g&&void 0===a[c]||(b[l[n]]=a[c]),c++,n++;else"object"===typeof a&&(b=a,a.dataLabels&&(d._hasPointLabels=!0),a.marker&&(d._hasPointMarkers=!0));return b},getClassName:function(){return"highcharts-point"+(this.selected?" highcharts-point-select":"")+(this.negative?" highcharts-negative":"")+(this.isNull?" highcharts-null-point":
"")+(void 0!==this.colorIndex?" highcharts-color-"+this.colorIndex:"")+(this.options.className?" "+this.options.className:"")+(this.zone&&this.zone.className?" "+this.zone.className.replace("highcharts-negative",""):"")},getZone:function(){var a=this.series,b=a.zones,a=a.zoneAxis||"y",f=0,g;for(g=b[f];this[a]>=g.value;)g=b[++f];g&&g.color&&!this.options.color&&(this.color=g.color);return g},destroy:function(){var a=this.series.chart,b=a.hoverPoints,f;a.pointCount--;b&&(this.setState(),G(b,this),b.length||
(a.hoverPoints=null));if(this===a.hoverPoint)this.onMouseOut();if(this.graphic||this.dataLabel)q(this),this.destroyElements();this.legendItem&&a.legend.destroyItem(this);for(f in this)this[f]=null},destroyElements:function(){for(var a=["graphic","dataLabel","dataLabelUpper","connector","shadowGroup"],b,f=6;f--;)b=a[f],this[b]&&(this[b]=this[b].destroy())},getLabelConfig:function(){return{x:this.category,y:this.y,color:this.color,colorIndex:this.colorIndex,key:this.name||this.category,series:this.series,
point:this,percentage:this.percentage,total:this.total||this.stackTotal}},tooltipFormatter:function(a){var b=this.series,d=b.tooltipOptions,f=l(d.valueDecimals,""),q=d.valuePrefix||"",m=d.valueSuffix||"";A(b.pointArrayMap||["y"],function(b){b="{point."+b;if(q||m)a=a.replace(b+"}",q+b+"}"+m);a=a.replace(b+"}",b+":,."+f+"f}")});return g(a,{point:this,series:this.series})},firePointEvent:function(a,b,f){var d=this,g=this.series.options;(g.point.events[a]||d.options&&d.options.events&&d.options.events[a])&&
this.importEvents();"click"===a&&g.allowPointSelect&&(f=function(a){d.select&&d.select(null,a.ctrlKey||a.metaKey||a.shiftKey)});r(this,a,b,f)},visible:!0}})(L);(function(a){var B=a.addEvent,A=a.animObject,H=a.arrayMax,G=a.arrayMin,r=a.correctFloat,g=a.Date,f=a.defaultOptions,u=a.defaultPlotOptions,l=a.defined,q=a.each,d=a.erase,b=a.extend,p=a.fireEvent,C=a.grep,t=a.isArray,m=a.isNumber,c=a.isString,n=a.merge,E=a.pick,z=a.removeEvent,e=a.splat,x=a.SVGElement,F=a.syncTimeout,w=a.win;a.Series=a.seriesType("line",
null,{lineWidth:2,allowPointSelect:!1,showCheckbox:!1,animation:{duration:1E3},events:{},marker:{lineWidth:0,lineColor:"#ffffff",radius:4,states:{hover:{animation:{duration:50},enabled:!0,radiusPlus:2,lineWidthPlus:1},select:{fillColor:"#cccccc",lineColor:"#000000",lineWidth:2}}},point:{events:{}},dataLabels:{align:"center",formatter:function(){return null===this.y?"":a.numberFormat(this.y,-1)},style:{fontSize:"11px",fontWeight:"bold",color:"contrast",textOutline:"1px contrast"},verticalAlign:"bottom",
x:0,y:0,padding:5},cropThreshold:300,pointRange:0,softThreshold:!0,states:{hover:{lineWidthPlus:1,marker:{},halo:{size:10,opacity:.25}},select:{marker:{}}},stickyTracking:!0,turboThreshold:1E3},{isCartesian:!0,pointClass:a.Point,sorted:!0,requireSorting:!0,directTouch:!1,axisTypes:["xAxis","yAxis"],colorCounter:0,parallelArrays:["x","y"],coll:"series",init:function(a,c){var e=this,h,d,k=a.series,f;e.chart=a;e.options=c=e.setOptions(c);e.linkedSeries=[];e.bindAxes();b(e,{name:c.name,state:"",visible:!1!==
c.visible,selected:!0===c.selected});d=c.events;for(h in d)B(e,h,d[h]);if(d&&d.click||c.point&&c.point.events&&c.point.events.click||c.allowPointSelect)a.runTrackerClick=!0;e.getColor();e.getSymbol();q(e.parallelArrays,function(a){e[a+"Data"]=[]});e.setData(c.data,!1);e.isCartesian&&(a.hasCartesianSeries=!0);k.length&&(f=k[k.length-1]);e._i=E(f&&f._i,-1)+1;a.orderSeries(this.insert(k))},insert:function(a){var b=this.options.index,c;if(m(b)){for(c=a.length;c--;)if(b>=E(a[c].options.index,a[c]._i)){a.splice(c+
1,0,this);break}-1===c&&a.unshift(this);c+=1}else a.push(this);return E(c,a.length-1)},bindAxes:function(){var b=this,c=b.options,e=b.chart,d;q(b.axisTypes||[],function(h){q(e[h],function(a){d=a.options;if(c[h]===d.index||void 0!==c[h]&&c[h]===d.id||void 0===c[h]&&0===d.index)b.insert(a.series),b[h]=a,a.isDirty=!0});b[h]||b.optionalAxis===h||a.error(18,!0)})},updateParallelArrays:function(a,b){var c=a.series,e=arguments,h=m(b)?function(e){var h="y"===e&&c.toYData?c.toYData(a):a[e];c[e+"Data"][b]=
h}:function(a){Array.prototype[b].apply(c[a+"Data"],Array.prototype.slice.call(e,2))};q(c.parallelArrays,h)},autoIncrement:function(){var a=this.options,b=this.xIncrement,c,e=a.pointIntervalUnit,b=E(b,a.pointStart,0);this.pointInterval=c=E(this.pointInterval,a.pointInterval,1);e&&(a=new g(b),"day"===e?a=+a[g.hcSetDate](a[g.hcGetDate]()+c):"month"===e?a=+a[g.hcSetMonth](a[g.hcGetMonth]()+c):"year"===e&&(a=+a[g.hcSetFullYear](a[g.hcGetFullYear]()+c)),c=a-b);this.xIncrement=b+c;return b},setOptions:function(a){var b=
this.chart,c=b.options.plotOptions,b=b.userOptions||{},e=b.plotOptions||{},h=c[this.type];this.userOptions=a;c=n(h,c.series,a);this.tooltipOptions=n(f.tooltip,f.plotOptions[this.type].tooltip,b.tooltip,e.series&&e.series.tooltip,e[this.type]&&e[this.type].tooltip,a.tooltip);null===h.marker&&delete c.marker;this.zoneAxis=c.zoneAxis;a=this.zones=(c.zones||[]).slice();!c.negativeColor&&!c.negativeFillColor||c.zones||a.push({value:c[this.zoneAxis+"Threshold"]||c.threshold||0,className:"highcharts-negative",
color:c.negativeColor,fillColor:c.negativeFillColor});a.length&&l(a[a.length-1].value)&&a.push({color:this.color,fillColor:this.fillColor});return c},getCyclic:function(a,b,c){var e,h=this.chart,d=this.userOptions,f=a+"Index",n=a+"Counter",m=c?c.length:E(h.options.chart[a+"Count"],h[a+"Count"]);b||(e=E(d[f],d["_"+f]),l(e)||(h.series.length||(h[n]=0),d["_"+f]=e=h[n]%m,h[n]+=1),c&&(b=c[e]));void 0!==e&&(this[f]=e);this[a]=b},getColor:function(){this.options.colorByPoint?this.options.color=null:this.getCyclic("color",
this.options.color||u[this.type].color,this.chart.options.colors)},getSymbol:function(){this.getCyclic("symbol",this.options.marker.symbol,this.chart.options.symbols)},drawLegendSymbol:a.LegendSymbolMixin.drawLineMarker,setData:function(b,e,d,f){var h=this,k=h.points,n=k&&k.length||0,g,p=h.options,y=h.chart,l=null,w=h.xAxis,x=p.turboThreshold,r=this.xData,z=this.yData,F=(g=h.pointArrayMap)&&g.length;b=b||[];g=b.length;e=E(e,!0);if(!1!==f&&g&&n===g&&!h.cropped&&!h.hasGroupedData&&h.visible)q(b,function(a,
b){k[b].update&&a!==p.data[b]&&k[b].update(a,!1,null,!1)});else{h.xIncrement=null;h.colorCounter=0;q(this.parallelArrays,function(a){h[a+"Data"].length=0});if(x&&g>x){for(d=0;null===l&&d<g;)l=b[d],d++;if(m(l))for(d=0;d<g;d++)r[d]=this.autoIncrement(),z[d]=b[d];else if(t(l))if(F)for(d=0;d<g;d++)l=b[d],r[d]=l[0],z[d]=l.slice(1,F+1);else for(d=0;d<g;d++)l=b[d],r[d]=l[0],z[d]=l[1];else a.error(12)}else for(d=0;d<g;d++)void 0!==b[d]&&(l={series:h},h.pointClass.prototype.applyOptions.apply(l,[b[d]]),h.updateParallelArrays(l,
d));c(z[0])&&a.error(14,!0);h.data=[];h.options.data=h.userOptions.data=b;for(d=n;d--;)k[d]&&k[d].destroy&&k[d].destroy();w&&(w.minRange=w.userMinRange);h.isDirty=y.isDirtyBox=!0;h.isDirtyData=!!k;d=!1}"point"===p.legendType&&(this.processData(),this.generatePoints());e&&y.redraw(d)},processData:function(b){var c=this.xData,e=this.yData,h=c.length,d;d=0;var k,f,n=this.xAxis,m,g=this.options;m=g.cropThreshold;var p=this.getExtremesFromAll||g.getExtremesFromAll,l=this.isCartesian,g=n&&n.val2lin,q=n&&
n.isLog,t,w;if(l&&!this.isDirty&&!n.isDirty&&!this.yAxis.isDirty&&!b)return!1;n&&(b=n.getExtremes(),t=b.min,w=b.max);if(l&&this.sorted&&!p&&(!m||h>m||this.forceCrop))if(c[h-1]<t||c[0]>w)c=[],e=[];else if(c[0]<t||c[h-1]>w)d=this.cropData(this.xData,this.yData,t,w),c=d.xData,e=d.yData,d=d.start,k=!0;for(m=c.length||1;--m;)h=q?g(c[m])-g(c[m-1]):c[m]-c[m-1],0<h&&(void 0===f||h<f)?f=h:0>h&&this.requireSorting&&a.error(15);this.cropped=k;this.cropStart=d;this.processedXData=c;this.processedYData=e;this.closestPointRange=
f},cropData:function(a,b,c,e){var h=a.length,d=0,f=h,n=E(this.cropShoulder,1),m;for(m=0;m<h;m++)if(a[m]>=c){d=Math.max(0,m-n);break}for(c=m;c<h;c++)if(a[c]>e){f=c+n;break}return{xData:a.slice(d,f),yData:b.slice(d,f),start:d,end:f}},generatePoints:function(){var a=this.options.data,b=this.data,c,d=this.processedXData,f=this.processedYData,k=this.pointClass,n=d.length,m=this.cropStart||0,g,p=this.hasGroupedData,l,q=[],t;b||p||(b=[],b.length=a.length,b=this.data=b);for(t=0;t<n;t++)g=m+t,p?(l=(new k).init(this,
[d[t]].concat(e(f[t]))),l.dataGroup=this.groupMap[t]):(l=b[g])||void 0===a[g]||(b[g]=l=(new k).init(this,a[g],d[t])),l.index=g,q[t]=l;if(b&&(n!==(c=b.length)||p))for(t=0;t<c;t++)t!==m||p||(t+=n),b[t]&&(b[t].destroyElements(),b[t].plotX=void 0);this.data=b;this.points=q},getExtremes:function(a){var b=this.yAxis,c=this.processedXData,e,h=[],d=0;e=this.xAxis.getExtremes();var f=e.min,n=e.max,g,p,l,q;a=a||this.stackedYData||this.processedYData||[];e=a.length;for(q=0;q<e;q++)if(p=c[q],l=a[q],g=(m(l,!0)||
t(l))&&(!b.isLog||l.length||0<l),p=this.getExtremesFromAll||this.options.getExtremesFromAll||this.cropped||(c[q+1]||p)>=f&&(c[q-1]||p)<=n,g&&p)if(g=l.length)for(;g--;)null!==l[g]&&(h[d++]=l[g]);else h[d++]=l;this.dataMin=G(h);this.dataMax=H(h)},translate:function(){this.processedXData||this.processData();this.generatePoints();var a=this.options,b=a.stacking,c=this.xAxis,e=c.categories,d=this.yAxis,k=this.points,f=k.length,n=!!this.modifyValue,g=a.pointPlacement,p="between"===g||m(g),q=a.threshold,
t=a.startFromThreshold?q:0,w,x,z,F,u=Number.MAX_VALUE;"between"===g&&(g=.5);m(g)&&(g*=E(a.pointRange||c.pointRange));for(a=0;a<f;a++){var C=k[a],A=C.x,B=C.y;x=C.low;var H=b&&d.stacks[(this.negStacks&&B<(t?0:q)?"-":"")+this.stackKey],G;d.isLog&&null!==B&&0>=B&&(C.isNull=!0);C.plotX=w=r(Math.min(Math.max(-1E5,c.translate(A,0,0,0,1,g,"flags"===this.type)),1E5));b&&this.visible&&!C.isNull&&H&&H[A]&&(F=this.getStackIndicator(F,A,this.index),G=H[A],B=G.points[F.key],x=B[0],B=B[1],x===t&&F.key===H[A].base&&
(x=E(q,d.min)),d.isLog&&0>=x&&(x=null),C.total=C.stackTotal=G.total,C.percentage=G.total&&C.y/G.total*100,C.stackY=B,G.setOffset(this.pointXOffset||0,this.barW||0));C.yBottom=l(x)?d.translate(x,0,1,0,1):null;n&&(B=this.modifyValue(B,C));C.plotY=x="number"===typeof B&&Infinity!==B?Math.min(Math.max(-1E5,d.translate(B,0,1,0,1)),1E5):void 0;C.isInside=void 0!==x&&0<=x&&x<=d.len&&0<=w&&w<=c.len;C.clientX=p?r(c.translate(A,0,0,0,1,g)):w;C.negative=C.y<(q||0);C.category=e&&void 0!==e[C.x]?e[C.x]:C.x;C.isNull||
(void 0!==z&&(u=Math.min(u,Math.abs(w-z))),z=w);C.zone=this.zones.length&&C.getZone()}this.closestPointRangePx=u},getValidPoints:function(a,b){var c=this.chart;return C(a||this.points||[],function(a){return b&&!c.isInsidePlot(a.plotX,a.plotY,c.inverted)?!1:!a.isNull})},setClip:function(a){var b=this.chart,c=this.options,e=b.renderer,d=b.inverted,h=this.clipBox,f=h||b.clipBox,n=this.sharedClipKey||["_sharedClip",a&&a.duration,a&&a.easing,f.height,c.xAxis,c.yAxis].join(),m=b[n],g=b[n+"m"];m||(a&&(f.width=
0,b[n+"m"]=g=e.clipRect(-99,d?-b.plotLeft:-b.plotTop,99,d?b.chartWidth:b.chartHeight)),b[n]=m=e.clipRect(f),m.count={length:0});a&&!m.count[this.index]&&(m.count[this.index]=!0,m.count.length+=1);!1!==c.clip&&(this.group.clip(a||h?m:b.clipRect),this.markerGroup.clip(g),this.sharedClipKey=n);a||(m.count[this.index]&&(delete m.count[this.index],--m.count.length),0===m.count.length&&n&&b[n]&&(h||(b[n]=b[n].destroy()),b[n+"m"]&&(this.markerGroup.clip(),b[n+"m"]=b[n+"m"].destroy())))},animate:function(a){var b=
this.chart,c=A(this.options.animation),e;a?this.setClip(c):(e=this.sharedClipKey,(a=b[e])&&a.animate({width:b.plotSizeX},c),b[e+"m"]&&b[e+"m"].animate({width:b.plotSizeX+99},c),this.animate=null)},afterAnimate:function(){this.setClip();p(this,"afterAnimate")},drawPoints:function(){var a=this.points,b=this.chart,c,e,d,k,f=this.options.marker,n,g,p,l,q=this.markerGroup,t=E(f.enabled,this.xAxis.isRadial?!0:null,this.closestPointRangePx>2*f.radius);if(!1!==f.enabled||this._hasPointMarkers)for(e=0;e<a.length;e++)d=
a[e],c=d.plotY,k=d.graphic,n=d.marker||{},g=!!d.marker,p=t&&void 0===n.enabled||n.enabled,l=d.isInside,p&&m(c)&&null!==d.y?(c=E(n.symbol,this.symbol),d.hasImage=0===c.indexOf("url"),p=this.markerAttribs(d,d.selected&&"select"),k?k[l?"show":"hide"](!0).animate(p):l&&(0<p.width||d.hasImage)&&(d.graphic=k=b.renderer.symbol(c,p.x,p.y,p.width,p.height,g?n:f).add(q)),k&&k.attr(this.pointAttribs(d,d.selected&&"select")),k&&k.addClass(d.getClassName(),!0)):k&&(d.graphic=k.destroy())},markerAttribs:function(a,
b){var c=this.options.marker,e=a.marker||{},d=E(e.radius,c.radius);b&&(c=c.states[b],b=e.states&&e.states[b],d=E(b&&b.radius,c&&c.radius,d+(c&&c.radiusPlus||0)));a.hasImage&&(d=0);a={x:Math.floor(a.plotX)-d,y:a.plotY-d};d&&(a.width=a.height=2*d);return a},pointAttribs:function(a,b){var c=this.options.marker,e=a&&a.options,d=e&&e.marker||{},h=this.color,f=e&&e.color,n=a&&a.color,e=E(d.lineWidth,c.lineWidth);a=a&&a.zone&&a.zone.color;h=f||a||n||h;a=d.fillColor||c.fillColor||h;h=d.lineColor||c.lineColor||
h;b&&(c=c.states[b],b=d.states&&d.states[b]||{},e=E(b.lineWidth,c.lineWidth,e+E(b.lineWidthPlus,c.lineWidthPlus,0)),a=b.fillColor||c.fillColor||a,h=b.lineColor||c.lineColor||h);return{stroke:h,"stroke-width":e,fill:a}},destroy:function(){var a=this,b=a.chart,c=/AppleWebKit\/533/.test(w.navigator.userAgent),e,f=a.data||[],k,n,m;p(a,"destroy");z(a);q(a.axisTypes||[],function(b){(m=a[b])&&m.series&&(d(m.series,a),m.isDirty=m.forceRedraw=!0)});a.legendItem&&a.chart.legend.destroyItem(a);for(e=f.length;e--;)(k=
f[e])&&k.destroy&&k.destroy();a.points=null;clearTimeout(a.animationTimeout);for(n in a)a[n]instanceof x&&!a[n].survive&&(e=c&&"group"===n?"hide":"destroy",a[n][e]());b.hoverSeries===a&&(b.hoverSeries=null);d(b.series,a);b.orderSeries();for(n in a)delete a[n]},getGraphPath:function(a,b,c){var e=this,d=e.options,h=d.step,f,n=[],m=[],g;a=a||e.points;(f=a.reversed)&&a.reverse();(h={right:1,center:2}[h]||h&&3)&&f&&(h=4-h);!d.connectNulls||b||c||(a=this.getValidPoints(a));q(a,function(f,k){var p=f.plotX,
q=f.plotY,t=a[k-1];(f.leftCliff||t&&t.rightCliff)&&!c&&(g=!0);f.isNull&&!l(b)&&0<k?g=!d.connectNulls:f.isNull&&!b?g=!0:(0===k||g?k=["M",f.plotX,f.plotY]:e.getPointSpline?k=e.getPointSpline(a,f,k):h?(k=1===h?["L",t.plotX,q]:2===h?["L",(t.plotX+p)/2,t.plotY,"L",(t.plotX+p)/2,q]:["L",p,t.plotY],k.push("L",p,q)):k=["L",p,q],m.push(f.x),h&&m.push(f.x),n.push.apply(n,k),g=!1)});n.xMap=m;return e.graphPath=n},drawGraph:function(){var a=this,b=this.options,c=(this.gappedPath||this.getGraphPath).call(this),
e=[["graph","highcharts-graph",b.lineColor||this.color,b.dashStyle]];q(this.zones,function(c,d){e.push(["zone-graph-"+d,"highcharts-graph highcharts-zone-graph-"+d+" "+(c.className||""),c.color||a.color,c.dashStyle||b.dashStyle])});q(e,function(e,d){var h=e[0],f=a[h];f?(f.endX=c.xMap,f.animate({d:c})):c.length&&(a[h]=a.chart.renderer.path(c).addClass(e[1]).attr({zIndex:1}).add(a.group),f={stroke:e[2],"stroke-width":b.lineWidth,fill:a.fillGraph&&a.color||"none"},e[3]?f.dashstyle=e[3]:"square"!==b.linecap&&
(f["stroke-linecap"]=f["stroke-linejoin"]="round"),f=a[h].attr(f).shadow(2>d&&b.shadow));f&&(f.startX=c.xMap,f.isArea=c.isArea)})},applyZones:function(){var a=this,b=this.chart,c=b.renderer,e=this.zones,d,f,n=this.clips||[],m,g=this.graph,p=this.area,l=Math.max(b.chartWidth,b.chartHeight),t=this[(this.zoneAxis||"y")+"Axis"],w,x,r=b.inverted,z,F,u,C,A=!1;e.length&&(g||p)&&t&&void 0!==t.min&&(x=t.reversed,z=t.horiz,g&&g.hide(),p&&p.hide(),w=t.getExtremes(),q(e,function(e,h){d=x?z?b.plotWidth:0:z?0:
t.toPixels(w.min);d=Math.min(Math.max(E(f,d),0),l);f=Math.min(Math.max(Math.round(t.toPixels(E(e.value,w.max),!0)),0),l);A&&(d=f=t.toPixels(w.max));F=Math.abs(d-f);u=Math.min(d,f);C=Math.max(d,f);t.isXAxis?(m={x:r?C:u,y:0,width:F,height:l},z||(m.x=b.plotHeight-m.x)):(m={x:0,y:r?C:u,width:l,height:F},z&&(m.y=b.plotWidth-m.y));r&&c.isVML&&(m=t.isXAxis?{x:0,y:x?u:C,height:m.width,width:b.chartWidth}:{x:m.y-b.plotLeft-b.spacingBox.x,y:0,width:m.height,height:b.chartHeight});n[h]?n[h].animate(m):(n[h]=
c.clipRect(m),g&&a["zone-graph-"+h].clip(n[h]),p&&a["zone-area-"+h].clip(n[h]));A=e.value>w.max}),this.clips=n)},invertGroups:function(a){function b(){q(["group","markerGroup"],function(b){c[b]&&(c[b].width=c.yAxis.len,c[b].height=c.xAxis.len,c[b].invert(a))})}var c=this,e;c.xAxis&&(e=B(c.chart,"resize",b),B(c,"destroy",e),b(a),c.invertGroups=b)},plotGroup:function(a,b,c,e,d){var h=this[a],f=!h;f&&(this[a]=h=this.chart.renderer.g(b).attr({zIndex:e||.1}).add(d),h.addClass("highcharts-series-"+this.index+
" highcharts-"+this.type+"-series highcharts-color-"+this.colorIndex+" "+(this.options.className||"")));h.attr({visibility:c})[f?"attr":"animate"](this.getPlotBox());return h},getPlotBox:function(){var a=this.chart,b=this.xAxis,c=this.yAxis;a.inverted&&(b=c,c=this.xAxis);return{translateX:b?b.left:a.plotLeft,translateY:c?c.top:a.plotTop,scaleX:1,scaleY:1}},render:function(){var a=this,b=a.chart,c,e=a.options,d=!!a.animate&&b.renderer.isSVG&&A(e.animation).duration,f=a.visible?"inherit":"hidden",n=
e.zIndex,m=a.hasRendered,g=b.seriesGroup,p=b.inverted;c=a.plotGroup("group","series",f,n,g);a.markerGroup=a.plotGroup("markerGroup","markers",f,n,g);d&&a.animate(!0);c.inverted=a.isCartesian?p:!1;a.drawGraph&&(a.drawGraph(),a.applyZones());a.drawDataLabels&&a.drawDataLabels();a.visible&&a.drawPoints();a.drawTracker&&!1!==a.options.enableMouseTracking&&a.drawTracker();a.invertGroups(p);!1===e.clip||a.sharedClipKey||m||c.clip(b.clipRect);d&&a.animate();m||(a.animationTimeout=F(function(){a.afterAnimate()},
d));a.isDirty=!1;a.hasRendered=!0},redraw:function(){var a=this.chart,b=this.isDirty||this.isDirtyData,c=this.group,e=this.xAxis,d=this.yAxis;c&&(a.inverted&&c.attr({width:a.plotWidth,height:a.plotHeight}),c.animate({translateX:E(e&&e.left,a.plotLeft),translateY:E(d&&d.top,a.plotTop)}));this.translate();this.render();b&&delete this.kdTree},kdDimensions:1,kdAxisArray:["clientX","plotY"],searchPoint:function(a,b){var c=this.xAxis,e=this.yAxis,d=this.chart.inverted;return this.searchKDTree({clientX:d?
c.len-a.chartY+c.pos:a.chartX-c.pos,plotY:d?e.len-a.chartX+e.pos:a.chartY-e.pos},b)},buildKDTree:function(){function a(c,e,d){var h,f;if(f=c&&c.length)return h=b.kdAxisArray[e%d],c.sort(function(a,b){return a[h]-b[h]}),f=Math.floor(f/2),{point:c[f],left:a(c.slice(0,f),e+1,d),right:a(c.slice(f+1),e+1,d)}}this.buildingKdTree=!0;var b=this,c=b.kdDimensions;delete b.kdTree;F(function(){b.kdTree=a(b.getValidPoints(null,!b.directTouch),c,c);b.buildingKdTree=!1},b.options.kdNow?0:1)},searchKDTree:function(a,
b){function c(a,b,k,n){var m=b.point,g=e.kdAxisArray[k%n],p,t,q=m;t=l(a[d])&&l(m[d])?Math.pow(a[d]-m[d],2):null;p=l(a[h])&&l(m[h])?Math.pow(a[h]-m[h],2):null;p=(t||0)+(p||0);m.dist=l(p)?Math.sqrt(p):Number.MAX_VALUE;m.distX=l(t)?Math.sqrt(t):Number.MAX_VALUE;g=a[g]-m[g];p=0>g?"left":"right";t=0>g?"right":"left";b[p]&&(p=c(a,b[p],k+1,n),q=p[f]<q[f]?p:m);b[t]&&Math.sqrt(g*g)<q[f]&&(a=c(a,b[t],k+1,n),q=a[f]<q[f]?a:q);return q}var e=this,d=this.kdAxisArray[0],h=this.kdAxisArray[1],f=b?"distX":"dist";
this.kdTree||this.buildingKdTree||this.buildKDTree();if(this.kdTree)return c(a,this.kdTree,this.kdDimensions,this.kdDimensions)}})})(L);(function(a){function B(a,d,b,f,g){var p=a.chart.inverted;this.axis=a;this.isNegative=b;this.options=d;this.x=f;this.total=null;this.points={};this.stack=g;this.rightCliff=this.leftCliff=0;this.alignOptions={align:d.align||(p?b?"left":"right":"center"),verticalAlign:d.verticalAlign||(p?"middle":b?"bottom":"top"),y:l(d.y,p?4:b?14:-6),x:l(d.x,p?b?-6:6:0)};this.textAlign=
d.textAlign||(p?b?"right":"left":"center")}var A=a.Axis,H=a.Chart,G=a.correctFloat,r=a.defined,g=a.destroyObjectProperties,f=a.each,u=a.format,l=a.pick;a=a.Series;B.prototype={destroy:function(){g(this,this.axis)},render:function(a){var d=this.options,b=d.format,b=b?u(b,this):d.formatter.call(this);this.label?this.label.attr({text:b,visibility:"hidden"}):this.label=this.axis.chart.renderer.text(b,null,null,d.useHTML).css(d.style).attr({align:this.textAlign,rotation:d.rotation,visibility:"hidden"}).add(a)},
setOffset:function(a,d){var b=this.axis,f=b.chart,g=f.inverted,l=b.reversed,l=this.isNegative&&!l||!this.isNegative&&l,m=b.translate(b.usePercentage?100:this.total,0,0,0,1),b=b.translate(0),b=Math.abs(m-b);a=f.xAxis[0].translate(this.x)+a;var c=f.plotHeight,g={x:g?l?m:m-b:a,y:g?c-a-d:l?c-m-b:c-m,width:g?b:d,height:g?d:b};if(d=this.label)d.align(this.alignOptions,null,g),g=d.alignAttr,d[!1===this.options.crop||f.isInsidePlot(g.x,g.y)?"show":"hide"](!0)}};H.prototype.getStacks=function(){var a=this;
f(a.yAxis,function(a){a.stacks&&a.hasVisibleSeries&&(a.oldStacks=a.stacks)});f(a.series,function(d){!d.options.stacking||!0!==d.visible&&!1!==a.options.chart.ignoreHiddenSeries||(d.stackKey=d.type+l(d.options.stack,""))})};A.prototype.buildStacks=function(){var a=this.series,d,b=l(this.options.reversedStacks,!0),f=a.length,g;if(!this.isXAxis){this.usePercentage=!1;for(g=f;g--;)a[b?g:f-g-1].setStackedPoints();for(g=f;g--;)d=a[b?g:f-g-1],d.setStackCliffs&&d.setStackCliffs();if(this.usePercentage)for(g=
0;g<f;g++)a[g].setPercentStacks()}};A.prototype.renderStackTotals=function(){var a=this.chart,d=a.renderer,b=this.stacks,f,g,l=this.stackTotalGroup;l||(this.stackTotalGroup=l=d.g("stack-labels").attr({visibility:"visible",zIndex:6}).add());l.translate(a.plotLeft,a.plotTop);for(f in b)for(g in a=b[f],a)a[g].render(l)};A.prototype.resetStacks=function(){var a=this.stacks,d,b;if(!this.isXAxis)for(d in a)for(b in a[d])a[d][b].touched<this.stacksTouched?(a[d][b].destroy(),delete a[d][b]):(a[d][b].total=
null,a[d][b].cum=null)};A.prototype.cleanStacks=function(){var a,d,b;if(!this.isXAxis)for(d in this.oldStacks&&(a=this.stacks=this.oldStacks),a)for(b in a[d])a[d][b].cum=a[d][b].total};a.prototype.setStackedPoints=function(){if(this.options.stacking&&(!0===this.visible||!1===this.chart.options.chart.ignoreHiddenSeries)){var a=this.processedXData,d=this.processedYData,b=[],f=d.length,g=this.options,t=g.threshold,m=g.startFromThreshold?t:0,c=g.stack,g=g.stacking,n=this.stackKey,u="-"+n,z=this.negStacks,
e=this.yAxis,x=e.stacks,F=e.oldStacks,w,h,y,A,K,I,k;e.stacksTouched+=1;for(K=0;K<f;K++)I=a[K],k=d[K],w=this.getStackIndicator(w,I,this.index),A=w.key,y=(h=z&&k<(m?0:t))?u:n,x[y]||(x[y]={}),x[y][I]||(F[y]&&F[y][I]?(x[y][I]=F[y][I],x[y][I].total=null):x[y][I]=new B(e,e.options.stackLabels,h,I,c)),y=x[y][I],null!==k&&(y.points[A]=y.points[this.index]=[l(y.cum,m)],r(y.cum)||(y.base=A),y.touched=e.stacksTouched,0<w.index&&!1===this.singleStacks&&(y.points[A][0]=y.points[this.index+","+I+",0"][0])),"percent"===
g?(h=h?n:u,z&&x[h]&&x[h][I]?(h=x[h][I],y.total=h.total=Math.max(h.total,y.total)+Math.abs(k)||0):y.total=G(y.total+(Math.abs(k)||0))):y.total=G(y.total+(k||0)),y.cum=l(y.cum,m)+(k||0),null!==k&&(y.points[A].push(y.cum),b[K]=y.cum);"percent"===g&&(e.usePercentage=!0);this.stackedYData=b;e.oldStacks={}}};a.prototype.setPercentStacks=function(){var a=this,d=a.stackKey,b=a.yAxis.stacks,g=a.processedXData,l;f([d,"-"+d],function(d){for(var f=g.length,c,n;f--;)if(c=g[f],l=a.getStackIndicator(l,c,a.index,
d),c=(n=b[d]&&b[d][c])&&n.points[l.key])n=n.total?100/n.total:0,c[0]=G(c[0]*n),c[1]=G(c[1]*n),a.stackedYData[f]=c[1]})};a.prototype.getStackIndicator=function(a,d,b,f){!r(a)||a.x!==d||f&&a.key!==f?a={x:d,index:0,key:f}:a.index++;a.key=[b,d,a.index].join();return a}})(L);(function(a){var B=a.addEvent,A=a.animate,H=a.Axis,G=a.createElement,r=a.css,g=a.defined,f=a.each,u=a.erase,l=a.extend,q=a.fireEvent,d=a.inArray,b=a.isNumber,p=a.isObject,C=a.merge,t=a.pick,m=a.Point,c=a.Series,n=a.seriesTypes,E=a.setAnimation,
z=a.splat;l(a.Chart.prototype,{addSeries:function(a,b,c){var e,d=this;a&&(b=t(b,!0),q(d,"addSeries",{options:a},function(){e=d.initSeries(a);d.isDirtyLegend=!0;d.linkSeries();b&&d.redraw(c)}));return e},addAxis:function(a,b,c,d){var e=b?"xAxis":"yAxis",f=this.options;a=C(a,{index:this[e].length,isX:b});new H(this,a);f[e]=z(f[e]||{});f[e].push(a);t(c,!0)&&this.redraw(d)},showLoading:function(a){var b=this,c=b.options,e=b.loadingDiv,d=c.loading,f=function(){e&&r(e,{left:b.plotLeft+"px",top:b.plotTop+
"px",width:b.plotWidth+"px",height:b.plotHeight+"px"})};e||(b.loadingDiv=e=G("div",{className:"highcharts-loading highcharts-loading-hidden"},null,b.container),b.loadingSpan=G("span",{className:"highcharts-loading-inner"},null,e),B(b,"redraw",f));e.className="highcharts-loading";b.loadingSpan.innerHTML=a||c.lang.loading;r(e,l(d.style,{zIndex:10}));r(b.loadingSpan,d.labelStyle);b.loadingShown||(r(e,{opacity:0,display:""}),A(e,{opacity:d.style.opacity||.5},{duration:d.showDuration||0}));b.loadingShown=
!0;f()},hideLoading:function(){var a=this.options,b=this.loadingDiv;b&&(b.className="highcharts-loading highcharts-loading-hidden",A(b,{opacity:0},{duration:a.loading.hideDuration||100,complete:function(){r(b,{display:"none"})}}));this.loadingShown=!1},propsRequireDirtyBox:"backgroundColor borderColor borderWidth margin marginTop marginRight marginBottom marginLeft spacing spacingTop spacingRight spacingBottom spacingLeft borderRadius plotBackgroundColor plotBackgroundImage plotBorderColor plotBorderWidth plotShadow shadow".split(" "),
propsRequireUpdateSeries:"chart.inverted chart.polar chart.ignoreHiddenSeries chart.type colors plotOptions".split(" "),update:function(a,c){var e,n={credits:"addCredits",title:"setTitle",subtitle:"setSubtitle"},h=a.chart,m,p;if(h){C(!0,this.options.chart,h);"className"in h&&this.setClassName(h.className);if("inverted"in h||"polar"in h)this.propFromSeries(),m=!0;for(e in h)h.hasOwnProperty(e)&&(-1!==d("chart."+e,this.propsRequireUpdateSeries)&&(p=!0),-1!==d(e,this.propsRequireDirtyBox)&&(this.isDirtyBox=
!0));"style"in h&&this.renderer.setStyle(h.style)}for(e in a){if(this[e]&&"function"===typeof this[e].update)this[e].update(a[e],!1);else if("function"===typeof this[n[e]])this[n[e]](a[e]);"chart"!==e&&-1!==d(e,this.propsRequireUpdateSeries)&&(p=!0)}a.colors&&(this.options.colors=a.colors);a.plotOptions&&C(!0,this.options.plotOptions,a.plotOptions);f(["xAxis","yAxis","series"],function(b){a[b]&&f(z(a[b]),function(a,c){(c=g(a.id)&&this.get(a.id)||this[b][c])&&c.coll===b&&c.update(a,!1)},this)},this);
m&&f(this.axes,function(a){a.update({},!1)});p&&f(this.series,function(a){a.update({},!1)});a.loading&&C(!0,this.options.loading,a.loading);e=h&&h.width;h=h&&h.height;b(e)&&e!==this.chartWidth||b(h)&&h!==this.chartHeight?this.setSize(e,h):t(c,!0)&&this.redraw()},setSubtitle:function(a){this.setTitle(void 0,a)}});l(m.prototype,{update:function(a,b,c,d){function e(){f.applyOptions(a);null===f.y&&n&&(f.graphic=n.destroy());p(a,!0)&&(n&&n.element&&a&&a.marker&&a.marker.symbol&&(f.graphic=n.destroy()),
a&&a.dataLabels&&f.dataLabel&&(f.dataLabel=f.dataLabel.destroy()));m=f.index;g.updateParallelArrays(f,m);l.data[m]=p(l.data[m],!0)?f.options:a;g.isDirty=g.isDirtyData=!0;!g.fixedBox&&g.hasCartesianSeries&&(k.isDirtyBox=!0);"point"===l.legendType&&(k.isDirtyLegend=!0);b&&k.redraw(c)}var f=this,g=f.series,n=f.graphic,m,k=g.chart,l=g.options;b=t(b,!0);!1===d?e():f.firePointEvent("update",{options:a},e)},remove:function(a,b){this.series.removePoint(d(this,this.series.data),a,b)}});l(c.prototype,{addPoint:function(a,
b,c,d){var e=this.options,f=this.data,g=this.chart,n=this.xAxis,n=n&&n.hasNames&&n.names,m=e.data,k,p,l=this.xData,q,w;b=t(b,!0);k={series:this};this.pointClass.prototype.applyOptions.apply(k,[a]);w=k.x;q=l.length;if(this.requireSorting&&w<l[q-1])for(p=!0;q&&l[q-1]>w;)q--;this.updateParallelArrays(k,"splice",q,0,0);this.updateParallelArrays(k,q);n&&k.name&&(n[w]=k.name);m.splice(q,0,a);p&&(this.data.splice(q,0,null),this.processData());"point"===e.legendType&&this.generatePoints();c&&(f[0]&&f[0].remove?
f[0].remove(!1):(f.shift(),this.updateParallelArrays(k,"shift"),m.shift()));this.isDirtyData=this.isDirty=!0;b&&g.redraw(d)},removePoint:function(a,b,c){var e=this,d=e.data,f=d[a],g=e.points,n=e.chart,m=function(){g&&g.length===d.length&&g.splice(a,1);d.splice(a,1);e.options.data.splice(a,1);e.updateParallelArrays(f||{series:e},"splice",a,1);f&&f.destroy();e.isDirty=!0;e.isDirtyData=!0;b&&n.redraw()};E(c,n);b=t(b,!0);f?f.firePointEvent("remove",null,m):m()},remove:function(a,b,c){function e(){d.destroy();
f.isDirtyLegend=f.isDirtyBox=!0;f.linkSeries();t(a,!0)&&f.redraw(b)}var d=this,f=d.chart;!1!==c?q(d,"remove",null,e):e()},update:function(a,b){var c=this,e=this.chart,d=this.userOptions,g=this.type,m=a.type||d.type||e.options.chart.type,p=n[g].prototype,q=["group","markerGroup","dataLabelsGroup"],k;if(m&&m!==g||void 0!==a.zIndex)q.length=0;f(q,function(a){q[a]=c[a];delete c[a]});a=C(d,{animation:!1,index:this.index,pointStart:this.xData[0]},{data:this.options.data},a);this.remove(!1,null,!1);for(k in p)this[k]=
void 0;l(this,n[m||g].prototype);f(q,function(a){c[a]=q[a]});this.init(e,a);e.linkSeries();t(b,!0)&&e.redraw(!1)}});l(H.prototype,{update:function(a,b){var c=this.chart;a=c.options[this.coll][this.options.index]=C(this.userOptions,a);this.destroy(!0);this.init(c,l(a,{events:void 0}));c.isDirtyBox=!0;t(b,!0)&&c.redraw()},remove:function(a){for(var b=this.chart,c=this.coll,e=this.series,d=e.length;d--;)e[d]&&e[d].remove(!1);u(b.axes,this);u(b[c],this);b.options[c].splice(this.options.index,1);f(b[c],
function(a,b){a.options.index=b});this.destroy();b.isDirtyBox=!0;t(a,!0)&&b.redraw()},setTitle:function(a,b){this.update({title:a},b)},setCategories:function(a,b){this.update({categories:a},b)}})})(L);(function(a){var B=a.color,A=a.each,H=a.map,G=a.pick,r=a.Series,g=a.seriesType;g("area","line",{softThreshold:!1,threshold:0},{singleStacks:!1,getStackPoints:function(){var a=[],g=[],l=this.xAxis,q=this.yAxis,d=q.stacks[this.stackKey],b={},p=this.points,r=this.index,t=q.series,m=t.length,c,n=G(q.options.reversedStacks,
!0)?1:-1,E,z;if(this.options.stacking){for(E=0;E<p.length;E++)b[p[E].x]=p[E];for(z in d)null!==d[z].total&&g.push(z);g.sort(function(a,b){return a-b});c=H(t,function(){return this.visible});A(g,function(e,f){var p=0,t,h;if(b[e]&&!b[e].isNull)a.push(b[e]),A([-1,1],function(a){var p=1===a?"rightNull":"leftNull",l=0,q=d[g[f+a]];if(q)for(E=r;0<=E&&E<m;)t=q.points[E],t||(E===r?b[e][p]=!0:c[E]&&(h=d[e].points[E])&&(l-=h[1]-h[0])),E+=n;b[e][1===a?"rightCliff":"leftCliff"]=l});else{for(E=r;0<=E&&E<m;){if(t=
d[e].points[E]){p=t[1];break}E+=n}p=q.toPixels(p,!0);a.push({isNull:!0,plotX:l.toPixels(e,!0),plotY:p,yBottom:p})}})}return a},getGraphPath:function(a){var f=r.prototype.getGraphPath,g=this.options,q=g.stacking,d=this.yAxis,b,p,C=[],t=[],m=this.index,c,n=d.stacks[this.stackKey],E=g.threshold,z=d.getThreshold(g.threshold),e,g=g.connectNulls||"percent"===q,x=function(b,e,f){var h=a[b];b=q&&n[h.x].points[m];var g=h[f+"Null"]||0;f=h[f+"Cliff"]||0;var p,l,h=!0;f||g?(p=(g?b[0]:b[1])+f,l=b[0]+f,h=!!g):!q&&
a[e]&&a[e].isNull&&(p=l=E);void 0!==p&&(t.push({plotX:c,plotY:null===p?z:d.getThreshold(p),isNull:h}),C.push({plotX:c,plotY:null===l?z:d.getThreshold(l),doCurve:!1}))};a=a||this.points;q&&(a=this.getStackPoints());for(b=0;b<a.length;b++)if(p=a[b].isNull,c=G(a[b].rectPlotX,a[b].plotX),e=G(a[b].yBottom,z),!p||g)g||x(b,b-1,"left"),p&&!q&&g||(t.push(a[b]),C.push({x:b,plotX:c,plotY:e})),g||x(b,b+1,"right");b=f.call(this,t,!0,!0);C.reversed=!0;p=f.call(this,C,!0,!0);p.length&&(p[0]="L");p=b.concat(p);f=
f.call(this,t,!1,g);p.xMap=b.xMap;this.areaPath=p;return f},drawGraph:function(){this.areaPath=[];r.prototype.drawGraph.apply(this);var a=this,g=this.areaPath,l=this.options,q=[["area","highcharts-area",this.color,l.fillColor]];A(this.zones,function(d,b){q.push(["zone-area-"+b,"highcharts-area highcharts-zone-area-"+b+" "+d.className,d.color||a.color,d.fillColor||l.fillColor])});A(q,function(d){var b=d[0],f=a[b];f?(f.endX=g.xMap,f.animate({d:g})):(f=a[b]=a.chart.renderer.path(g).addClass(d[1]).attr({fill:G(d[3],
B(d[2]).setOpacity(G(l.fillOpacity,.75)).get()),zIndex:0}).add(a.group),f.isArea=!0);f.startX=g.xMap;f.shiftUnit=l.step?2:1})},drawLegendSymbol:a.LegendSymbolMixin.drawRectangle})})(L);(function(a){var B=a.pick;a=a.seriesType;a("spline","line",{},{getPointSpline:function(a,H,G){var r=H.plotX,g=H.plotY,f=a[G-1];G=a[G+1];var u,l,q,d;if(f&&!f.isNull&&!1!==f.doCurve&&G&&!G.isNull&&!1!==G.doCurve){a=f.plotY;q=G.plotX;G=G.plotY;var b=0;u=(1.5*r+f.plotX)/2.5;l=(1.5*g+a)/2.5;q=(1.5*r+q)/2.5;d=(1.5*g+G)/2.5;
q!==u&&(b=(d-l)*(q-r)/(q-u)+g-d);l+=b;d+=b;l>a&&l>g?(l=Math.max(a,g),d=2*g-l):l<a&&l<g&&(l=Math.min(a,g),d=2*g-l);d>G&&d>g?(d=Math.max(G,g),l=2*g-d):d<G&&d<g&&(d=Math.min(G,g),l=2*g-d);H.rightContX=q;H.rightContY=d}H=["C",B(f.rightContX,f.plotX),B(f.rightContY,f.plotY),B(u,r),B(l,g),r,g];f.rightContX=f.rightContY=null;return H}})})(L);(function(a){var B=a.seriesTypes.area.prototype,A=a.seriesType;A("areaspline","spline",a.defaultPlotOptions.area,{getStackPoints:B.getStackPoints,getGraphPath:B.getGraphPath,
setStackCliffs:B.setStackCliffs,drawGraph:B.drawGraph,drawLegendSymbol:a.LegendSymbolMixin.drawRectangle})})(L);(function(a){var B=a.animObject,A=a.color,H=a.each,G=a.extend,r=a.isNumber,g=a.merge,f=a.pick,u=a.Series,l=a.seriesType,q=a.svg;l("column","line",{borderRadius:0,groupPadding:.2,marker:null,pointPadding:.1,minPointLength:0,cropThreshold:50,pointRange:null,states:{hover:{halo:!1,brightness:.1,shadow:!1},select:{color:"#cccccc",borderColor:"#000000",shadow:!1}},dataLabels:{align:null,verticalAlign:null,
y:null},softThreshold:!1,startFromThreshold:!0,stickyTracking:!1,tooltip:{distance:6},threshold:0,borderColor:"#ffffff"},{cropShoulder:0,directTouch:!0,trackerGroups:["group","dataLabelsGroup"],negStacks:!0,init:function(){u.prototype.init.apply(this,arguments);var a=this,b=a.chart;b.hasRendered&&H(b.series,function(b){b.type===a.type&&(b.isDirty=!0)})},getColumnMetrics:function(){var a=this,b=a.options,g=a.xAxis,l=a.yAxis,t=g.reversed,m,c={},n=0;!1===b.grouping?n=1:H(a.chart.series,function(b){var e=
b.options,d=b.yAxis,f;b.type===a.type&&b.visible&&l.len===d.len&&l.pos===d.pos&&(e.stacking?(m=b.stackKey,void 0===c[m]&&(c[m]=n++),f=c[m]):!1!==e.grouping&&(f=n++),b.columnIndex=f)});var q=Math.min(Math.abs(g.transA)*(g.ordinalSlope||b.pointRange||g.closestPointRange||g.tickInterval||1),g.len),r=q*b.groupPadding,e=(q-2*r)/(n||1),b=Math.min(b.maxPointWidth||g.len,f(b.pointWidth,e*(1-2*b.pointPadding)));a.columnMetrics={width:b,offset:(e-b)/2+(r+((a.columnIndex||0)+(t?1:0))*e-q/2)*(t?-1:1)};return a.columnMetrics},
crispCol:function(a,b,f,g){var d=this.chart,m=this.borderWidth,c=-(m%2?.5:0),m=m%2?.5:1;d.inverted&&d.renderer.isVML&&(m+=1);f=Math.round(a+f)+c;a=Math.round(a)+c;g=Math.round(b+g)+m;c=.5>=Math.abs(b)&&.5<g;b=Math.round(b)+m;g-=b;c&&g&&(--b,g+=1);return{x:a,y:b,width:f-a,height:g}},translate:function(){var a=this,b=a.chart,g=a.options,l=a.dense=2>a.closestPointRange*a.xAxis.transA,l=a.borderWidth=f(g.borderWidth,l?0:1),t=a.yAxis,m=a.translatedThreshold=t.getThreshold(g.threshold),c=f(g.minPointLength,
5),n=a.getColumnMetrics(),q=n.width,r=a.barW=Math.max(q,1+2*l),e=a.pointXOffset=n.offset;b.inverted&&(m-=.5);g.pointPadding&&(r=Math.ceil(r));u.prototype.translate.apply(a);H(a.points,function(d){var g=f(d.yBottom,m),n=999+Math.abs(g),n=Math.min(Math.max(-n,d.plotY),t.len+n),h=d.plotX+e,l=r,p=Math.min(n,g),z,x=Math.max(n,g)-p;Math.abs(x)<c&&c&&(x=c,z=!t.reversed&&!d.negative||t.reversed&&d.negative,p=Math.abs(p-m)>c?g-c:m-(z?c:0));d.barX=h;d.pointWidth=q;d.tooltipPos=b.inverted?[t.len+t.pos-b.plotLeft-
n,a.xAxis.len-h-l/2,x]:[h+l/2,n+t.pos-b.plotTop,x];d.shapeType="rect";d.shapeArgs=a.crispCol.apply(a,d.isNull?[d.plotX,t.len/2,0,0]:[h,p,l,x])})},getSymbol:a.noop,drawLegendSymbol:a.LegendSymbolMixin.drawRectangle,drawGraph:function(){this.group[this.dense?"addClass":"removeClass"]("highcharts-dense-data")},pointAttribs:function(a,b){var d=this.options,f,g=this.pointAttrToOptions||{};f=g.stroke||"borderColor";var m=g["stroke-width"]||"borderWidth",c=a&&a.color||this.color,n=a[f]||d[f]||this.color||
c,l=a[m]||d[m]||this[m]||0,g=d.dashStyle;a&&this.zones.length&&(c=(c=a.getZone())&&c.color||a.options.color||this.color);b&&(a=d.states[b],b=a.brightness,c=a.color||void 0!==b&&A(c).brighten(a.brightness).get()||c,n=a[f]||n,l=a[m]||l,g=a.dashStyle||g);f={fill:c,stroke:n,"stroke-width":l};d.borderRadius&&(f.r=d.borderRadius);g&&(f.dashstyle=g);return f},drawPoints:function(){var a=this,b=this.chart,f=a.options,l=b.renderer,t=f.animationLimit||250,m;H(a.points,function(c){var d=c.graphic;if(r(c.plotY)&&
null!==c.y){m=c.shapeArgs;if(d)d[b.pointCount<t?"animate":"attr"](g(m));else c.graphic=d=l[c.shapeType](m).attr({"class":c.getClassName()}).add(c.group||a.group);d.attr(a.pointAttribs(c,c.selected&&"select")).shadow(f.shadow,null,f.stacking&&!f.borderRadius)}else d&&(c.graphic=d.destroy())})},animate:function(a){var b=this,d=this.yAxis,f=b.options,g=this.chart.inverted,m={};q&&(a?(m.scaleY=.001,a=Math.min(d.pos+d.len,Math.max(d.pos,d.toPixels(f.threshold))),g?m.translateX=a-d.len:m.translateY=a,b.group.attr(m)):
(m[g?"translateX":"translateY"]=d.pos,b.group.animate(m,G(B(b.options.animation),{step:function(a,d){b.group.attr({scaleY:Math.max(.001,d.pos)})}})),b.animate=null))},remove:function(){var a=this,b=a.chart;b.hasRendered&&H(b.series,function(b){b.type===a.type&&(b.isDirty=!0)});u.prototype.remove.apply(a,arguments)}})})(L);(function(a){a=a.seriesType;a("bar","column",null,{inverted:!0})})(L);(function(a){var B=a.Series;a=a.seriesType;a("scatter","line",{lineWidth:0,marker:{enabled:!0},tooltip:{headerFormat:'\x3cspan style\x3d"color:{point.color}"\x3e\u25cf\x3c/span\x3e \x3cspan style\x3d"font-size: 0.85em"\x3e {series.name}\x3c/span\x3e\x3cbr/\x3e',
pointFormat:"x: \x3cb\x3e{point.x}\x3c/b\x3e\x3cbr/\x3ey: \x3cb\x3e{point.y}\x3c/b\x3e\x3cbr/\x3e"}},{sorted:!1,requireSorting:!1,noSharedTooltip:!0,trackerGroups:["group","markerGroup","dataLabelsGroup"],takeOrdinalPosition:!1,kdDimensions:2,drawGraph:function(){this.options.lineWidth&&B.prototype.drawGraph.call(this)}})})(L);(function(a){var B=a.pick,A=a.relativeLength;a.CenteredSeriesMixin={getCenter:function(){var a=this.options,G=this.chart,r=2*(a.slicedOffset||0),g=G.plotWidth-2*r,G=G.plotHeight-
2*r,f=a.center,f=[B(f[0],"50%"),B(f[1],"50%"),a.size||"100%",a.innerSize||0],u=Math.min(g,G),l,q;for(l=0;4>l;++l)q=f[l],a=2>l||2===l&&/%$/.test(q),f[l]=A(q,[g,G,u,f[2]][l])+(a?r:0);f[3]>f[2]&&(f[3]=f[2]);return f}}})(L);(function(a){var B=a.addEvent,A=a.defined,H=a.each,G=a.extend,r=a.inArray,g=a.noop,f=a.pick,u=a.Point,l=a.Series,q=a.seriesType,d=a.setAnimation;q("pie","line",{center:[null,null],clip:!1,colorByPoint:!0,dataLabels:{distance:30,enabled:!0,formatter:function(){return null===this.y?
void 0:this.point.name},x:0},ignoreHiddenPoint:!0,legendType:"point",marker:null,size:null,showInLegend:!1,slicedOffset:10,stickyTracking:!1,tooltip:{followPointer:!0},borderColor:"#ffffff",borderWidth:1,states:{hover:{brightness:.1,shadow:!1}}},{isCartesian:!1,requireSorting:!1,directTouch:!0,noSharedTooltip:!0,trackerGroups:["group","dataLabelsGroup"],axisTypes:[],pointAttribs:a.seriesTypes.column.prototype.pointAttribs,animate:function(a){var b=this,d=b.points,f=b.startAngleRad;a||(H(d,function(a){var c=
a.graphic,d=a.shapeArgs;c&&(c.attr({r:a.startR||b.center[3]/2,start:f,end:f}),c.animate({r:d.r,start:d.start,end:d.end},b.options.animation))}),b.animate=null)},updateTotals:function(){var a,d=0,f=this.points,g=f.length,m,c=this.options.ignoreHiddenPoint;for(a=0;a<g;a++)m=f[a],0>m.y&&(m.y=null),d+=c&&!m.visible?0:m.y;this.total=d;for(a=0;a<g;a++)m=f[a],m.percentage=0<d&&(m.visible||!c)?m.y/d*100:0,m.total=d},generatePoints:function(){l.prototype.generatePoints.call(this);this.updateTotals()},translate:function(a){this.generatePoints();
var b=0,d=this.options,g=d.slicedOffset,m=g+(d.borderWidth||0),c,n,l,q=d.startAngle||0,e=this.startAngleRad=Math.PI/180*(q-90),q=(this.endAngleRad=Math.PI/180*(f(d.endAngle,q+360)-90))-e,r=this.points,u=d.dataLabels.distance,d=d.ignoreHiddenPoint,w,h=r.length,y;a||(this.center=a=this.getCenter());this.getX=function(b,c){l=Math.asin(Math.min((b-a[1])/(a[2]/2+u),1));return a[0]+(c?-1:1)*Math.cos(l)*(a[2]/2+u)};for(w=0;w<h;w++){y=r[w];c=e+b*q;if(!d||y.visible)b+=y.percentage/100;n=e+b*q;y.shapeType=
"arc";y.shapeArgs={x:a[0],y:a[1],r:a[2]/2,innerR:a[3]/2,start:Math.round(1E3*c)/1E3,end:Math.round(1E3*n)/1E3};l=(n+c)/2;l>1.5*Math.PI?l-=2*Math.PI:l<-Math.PI/2&&(l+=2*Math.PI);y.slicedTranslation={translateX:Math.round(Math.cos(l)*g),translateY:Math.round(Math.sin(l)*g)};c=Math.cos(l)*a[2]/2;n=Math.sin(l)*a[2]/2;y.tooltipPos=[a[0]+.7*c,a[1]+.7*n];y.half=l<-Math.PI/2||l>Math.PI/2?1:0;y.angle=l;m=Math.min(m,u/5);y.labelPos=[a[0]+c+Math.cos(l)*u,a[1]+n+Math.sin(l)*u,a[0]+c+Math.cos(l)*m,a[1]+n+Math.sin(l)*
m,a[0]+c,a[1]+n,0>u?"center":y.half?"right":"left",l]}},drawGraph:null,drawPoints:function(){var a=this,d=a.chart.renderer,f,g,m,c,n=a.options.shadow;n&&!a.shadowGroup&&(a.shadowGroup=d.g("shadow").add(a.group));H(a.points,function(b){if(null!==b.y){g=b.graphic;c=b.shapeArgs;f=b.sliced?b.slicedTranslation:{};var l=b.shadowGroup;n&&!l&&(l=b.shadowGroup=d.g("shadow").add(a.shadowGroup));l&&l.attr(f);m=a.pointAttribs(b,b.selected&&"select");g?g.setRadialReference(a.center).attr(m).animate(G(c,f)):(b.graphic=
g=d[b.shapeType](c).addClass(b.getClassName()).setRadialReference(a.center).attr(f).add(a.group),b.visible||g.attr({visibility:"hidden"}),g.attr(m).attr({"stroke-linejoin":"round"}).shadow(n,l))}})},searchPoint:g,sortByAngle:function(a,d){a.sort(function(a,b){return void 0!==a.angle&&(b.angle-a.angle)*d})},drawLegendSymbol:a.LegendSymbolMixin.drawRectangle,getCenter:a.CenteredSeriesMixin.getCenter,getSymbol:g},{init:function(){u.prototype.init.apply(this,arguments);var a=this,d;a.name=f(a.name,"Slice");
d=function(b){a.slice("select"===b.type)};B(a,"select",d);B(a,"unselect",d);return a},setVisible:function(a,d){var b=this,g=b.series,m=g.chart,c=g.options.ignoreHiddenPoint;d=f(d,c);a!==b.visible&&(b.visible=b.options.visible=a=void 0===a?!b.visible:a,g.options.data[r(b,g.data)]=b.options,H(["graphic","dataLabel","connector","shadowGroup"],function(c){if(b[c])b[c][a?"show":"hide"](!0)}),b.legendItem&&m.legend.colorizeItem(b,a),a||"hover"!==b.state||b.setState(""),c&&(g.isDirty=!0),d&&m.redraw())},
slice:function(a,g,l){var b=this.series;d(l,b.chart);f(g,!0);this.sliced=this.options.sliced=a=A(a)?a:!this.sliced;b.options.data[r(this,b.data)]=this.options;a=a?this.slicedTranslation:{translateX:0,translateY:0};this.graphic.animate(a);this.shadowGroup&&this.shadowGroup.animate(a)},haloPath:function(a){var b=this.shapeArgs;return this.sliced||!this.visible?[]:this.series.chart.renderer.symbols.arc(b.x,b.y,b.r+a,b.r+a,{innerR:this.shapeArgs.r,start:b.start,end:b.end})}})})(L);(function(a){var B=
a.addEvent,A=a.arrayMax,H=a.defined,G=a.each,r=a.extend,g=a.format,f=a.map,u=a.merge,l=a.noop,q=a.pick,d=a.relativeLength,b=a.Series,p=a.seriesTypes,C=a.stableSort;a.distribute=function(a,b){function c(a,b){return a.target-b.target}var d,g=!0,m=a,e=[],l;l=0;for(d=a.length;d--;)l+=a[d].size;if(l>b){C(a,function(a,b){return(b.rank||0)-(a.rank||0)});for(l=d=0;l<=b;)l+=a[d].size,d++;e=a.splice(d-1,a.length)}C(a,c);for(a=f(a,function(a){return{size:a.size,targets:[a.target]}});g;){for(d=a.length;d--;)g=
a[d],l=(Math.min.apply(0,g.targets)+Math.max.apply(0,g.targets))/2,g.pos=Math.min(Math.max(0,l-g.size/2),b-g.size);d=a.length;for(g=!1;d--;)0<d&&a[d-1].pos+a[d-1].size>a[d].pos&&(a[d-1].size+=a[d].size,a[d-1].targets=a[d-1].targets.concat(a[d].targets),a[d-1].pos+a[d-1].size>b&&(a[d-1].pos=b-a[d-1].size),a.splice(d,1),g=!0)}d=0;G(a,function(a){var b=0;G(a.targets,function(){m[d].pos=a.pos+b;b+=m[d].size;d++})});m.push.apply(m,e);C(m,c)};b.prototype.drawDataLabels=function(){var a=this,b=a.options,
c=b.dataLabels,d=a.points,f,l,e=a.hasRendered||0,p,r,w=q(c.defer,!0),h=a.chart.renderer;if(c.enabled||a._hasPointLabels)a.dlProcessOptions&&a.dlProcessOptions(c),r=a.plotGroup("dataLabelsGroup","data-labels",w&&!e?"hidden":"visible",c.zIndex||6),w&&(r.attr({opacity:+e}),e||B(a,"afterAnimate",function(){a.visible&&r.show(!0);r[b.animation?"animate":"attr"]({opacity:1},{duration:200})})),l=c,G(d,function(e){var d,m=e.dataLabel,n,k,t,z=e.connector,w=!m,x;f=e.dlOptions||e.options&&e.options.dataLabels;
if(d=q(f&&f.enabled,l.enabled)&&null!==e.y)for(k in c=u(l,f),n=e.getLabelConfig(),p=c.format?g(c.format,n):c.formatter.call(n,c),x=c.style,t=c.rotation,x.color=q(c.color,x.color,a.color,"#000000"),"contrast"===x.color&&(x.color=c.inside||0>c.distance||b.stacking?h.getContrast(e.color||a.color):"#000000"),b.cursor&&(x.cursor=b.cursor),n={fill:c.backgroundColor,stroke:c.borderColor,"stroke-width":c.borderWidth,r:c.borderRadius||0,rotation:t,padding:c.padding,zIndex:1},n)void 0===n[k]&&delete n[k];!m||
d&&H(p)?d&&H(p)&&(m?n.text=p:(m=e.dataLabel=h[t?"text":"label"](p,0,-9999,c.shape,null,null,c.useHTML,null,"data-label"),m.addClass("highcharts-data-label-color-"+e.colorIndex+" "+(c.className||"")+(c.useHTML?"highcharts-tracker":""))),m.attr(n),m.css(x).shadow(c.shadow),m.added||m.add(r),a.alignDataLabel(e,m,c,null,w)):(e.dataLabel=m.destroy(),z&&(e.connector=z.destroy()))})};b.prototype.alignDataLabel=function(a,b,c,d,f){var g=this.chart,e=g.inverted,m=q(a.plotX,-9999),n=q(a.plotY,-9999),l=b.getBBox(),
h,p=c.rotation,t=c.align,u=this.visible&&(a.series.forceDL||g.isInsidePlot(m,Math.round(n),e)||d&&g.isInsidePlot(m,e?d.x+1:d.y+d.height-1,e)),E="justify"===q(c.overflow,"justify");u&&(h=c.style.fontSize,h=g.renderer.fontMetrics(h,b).b,d=r({x:e?g.plotWidth-n:m,y:Math.round(e?g.plotHeight-m:n),width:0,height:0},d),r(c,{width:l.width,height:l.height}),p?(E=!1,e=g.renderer.rotCorr(h,p),e={x:d.x+c.x+d.width/2+e.x,y:d.y+c.y+{top:0,middle:.5,bottom:1}[c.verticalAlign]*d.height},b[f?"attr":"animate"](e).attr({align:t}),
m=(p+720)%360,m=180<m&&360>m,"left"===t?e.y-=m?l.height:0:"center"===t?(e.x-=l.width/2,e.y-=l.height/2):"right"===t&&(e.x-=l.width,e.y-=m?0:l.height)):(b.align(c,null,d),e=b.alignAttr),E?this.justifyDataLabel(b,c,e,l,d,f):q(c.crop,!0)&&(u=g.isInsidePlot(e.x,e.y)&&g.isInsidePlot(e.x+l.width,e.y+l.height)),c.shape&&!p&&b.attr({anchorX:a.plotX,anchorY:a.plotY}));u||(b.attr({y:-9999}),b.placed=!1)};b.prototype.justifyDataLabel=function(a,b,c,d,f,g){var e=this.chart,m=b.align,n=b.verticalAlign,l,h,p=a.box?
0:a.padding||0;l=c.x+p;0>l&&("right"===m?b.align="left":b.x=-l,h=!0);l=c.x+d.width-p;l>e.plotWidth&&("left"===m?b.align="right":b.x=e.plotWidth-l,h=!0);l=c.y+p;0>l&&("bottom"===n?b.verticalAlign="top":b.y=-l,h=!0);l=c.y+d.height-p;l>e.plotHeight&&("top"===n?b.verticalAlign="bottom":b.y=e.plotHeight-l,h=!0);h&&(a.placed=!g,a.align(b,null,f))};p.pie&&(p.pie.prototype.drawDataLabels=function(){var d=this,g=d.data,c,l=d.chart,p=d.options.dataLabels,r=q(p.connectorPadding,10),e=q(p.connectorWidth,1),u=
l.plotWidth,F=l.plotHeight,w,h=p.distance,y=d.center,C=y[2]/2,B=y[1],H=0<h,k,D,L,N,S=[[],[]],O,v,M,Q,R=[0,0,0,0];d.visible&&(p.enabled||d._hasPointLabels)&&(b.prototype.drawDataLabels.apply(d),G(g,function(a){a.dataLabel&&a.visible&&(S[a.half].push(a),a.dataLabel._pos=null)}),G(S,function(b,e){var g,m,n=b.length,q,t,z;if(n)for(d.sortByAngle(b,e-.5),0<h&&(g=Math.max(0,B-C-h),m=Math.min(B+C+h,l.plotHeight),q=f(b,function(a){if(a.dataLabel)return z=a.dataLabel.getBBox().height||21,{target:a.labelPos[1]-
g+z/2,size:z,rank:a.y}}),a.distribute(q,m+z-g)),Q=0;Q<n;Q++)c=b[Q],L=c.labelPos,k=c.dataLabel,M=!1===c.visible?"hidden":"inherit",t=L[1],q?void 0===q[Q].pos?M="hidden":(N=q[Q].size,v=g+q[Q].pos):v=t,O=p.justify?y[0]+(e?-1:1)*(C+h):d.getX(v<g+2||v>m-2?t:v,e),k._attr={visibility:M,align:L[6]},k._pos={x:O+p.x+({left:r,right:-r}[L[6]]||0),y:v+p.y-10},L.x=O,L.y=v,null===d.options.size&&(D=k.width,O-D<r?R[3]=Math.max(Math.round(D-O+r),R[3]):O+D>u-r&&(R[1]=Math.max(Math.round(O+D-u+r),R[1])),0>v-N/2?R[0]=
Math.max(Math.round(-v+N/2),R[0]):v+N/2>F&&(R[2]=Math.max(Math.round(v+N/2-F),R[2])))}),0===A(R)||this.verifyDataLabelOverflow(R))&&(this.placeDataLabels(),H&&e&&G(this.points,function(a){var b;w=a.connector;if((k=a.dataLabel)&&k._pos&&a.visible){M=k._attr.visibility;if(b=!w)a.connector=w=l.renderer.path().addClass("highcharts-data-label-connector highcharts-color-"+a.colorIndex).add(d.dataLabelsGroup),w.attr({"stroke-width":e,stroke:p.connectorColor||a.color||"#666666"});w[b?"attr":"animate"]({d:d.connectorPath(a.labelPos)});
w.attr("visibility",M)}else w&&(a.connector=w.destroy())}))},p.pie.prototype.connectorPath=function(a){var b=a.x,c=a.y;return q(this.options.dataLabels.softConnector,!0)?["M",b+("left"===a[6]?5:-5),c,"C",b,c,2*a[2]-a[4],2*a[3]-a[5],a[2],a[3],"L",a[4],a[5]]:["M",b+("left"===a[6]?5:-5),c,"L",a[2],a[3],"L",a[4],a[5]]},p.pie.prototype.placeDataLabels=function(){G(this.points,function(a){var b=a.dataLabel;b&&a.visible&&((a=b._pos)?(b.attr(b._attr),b[b.moved?"animate":"attr"](a),b.moved=!0):b&&b.attr({y:-9999}))})},
p.pie.prototype.alignDataLabel=l,p.pie.prototype.verifyDataLabelOverflow=function(a){var b=this.center,c=this.options,f=c.center,g=c.minSize||80,l,e;null!==f[0]?l=Math.max(b[2]-Math.max(a[1],a[3]),g):(l=Math.max(b[2]-a[1]-a[3],g),b[0]+=(a[3]-a[1])/2);null!==f[1]?l=Math.max(Math.min(l,b[2]-Math.max(a[0],a[2])),g):(l=Math.max(Math.min(l,b[2]-a[0]-a[2]),g),b[1]+=(a[0]-a[2])/2);l<b[2]?(b[2]=l,b[3]=Math.min(d(c.innerSize||0,l),l),this.translate(b),this.drawDataLabels&&this.drawDataLabels()):e=!0;return e});
p.column&&(p.column.prototype.alignDataLabel=function(a,d,c,f,g){var l=this.chart.inverted,e=a.series,m=a.dlBox||a.shapeArgs,n=q(a.below,a.plotY>q(this.translatedThreshold,e.yAxis.len)),p=q(c.inside,!!this.options.stacking);m&&(f=u(m),0>f.y&&(f.height+=f.y,f.y=0),m=f.y+f.height-e.yAxis.len,0<m&&(f.height-=m),l&&(f={x:e.yAxis.len-f.y-f.height,y:e.xAxis.len-f.x-f.width,width:f.height,height:f.width}),p||(l?(f.x+=n?0:f.width,f.width=0):(f.y+=n?f.height:0,f.height=0)));c.align=q(c.align,!l||p?"center":
n?"right":"left");c.verticalAlign=q(c.verticalAlign,l||p?"middle":n?"top":"bottom");b.prototype.alignDataLabel.call(this,a,d,c,f,g)})})(L);(function(a){var B=a.Chart,A=a.each,H=a.pick,G=a.addEvent;B.prototype.callbacks.push(function(a){function g(){var f=[];A(a.series,function(a){var g=a.options.dataLabels,q=a.dataLabelCollections||["dataLabel"];(g.enabled||a._hasPointLabels)&&!g.allowOverlap&&a.visible&&A(q,function(d){A(a.points,function(a){a[d]&&(a[d].labelrank=H(a.labelrank,a.shapeArgs&&a.shapeArgs.height),
f.push(a[d]))})})});a.hideOverlappingLabels(f)}g();G(a,"redraw",g)});B.prototype.hideOverlappingLabels=function(a){var g=a.length,f,r,l,q,d,b,p,C,t,m=function(a,b,d,f,e,g,l,m){return!(e>a+d||e+l<a||g>b+f||g+m<b)};for(r=0;r<g;r++)if(f=a[r])f.oldOpacity=f.opacity,f.newOpacity=1;a.sort(function(a,b){return(b.labelrank||0)-(a.labelrank||0)});for(r=0;r<g;r++)for(l=a[r],f=r+1;f<g;++f)if(q=a[f],l&&q&&l.placed&&q.placed&&0!==l.newOpacity&&0!==q.newOpacity&&(d=l.alignAttr,b=q.alignAttr,p=l.parentGroup,C=q.parentGroup,
t=2*(l.box?0:l.padding),d=m(d.x+p.translateX,d.y+p.translateY,l.width-t,l.height-t,b.x+C.translateX,b.y+C.translateY,q.width-t,q.height-t)))(l.labelrank<q.labelrank?l:q).newOpacity=0;A(a,function(a){var b,c;a&&(c=a.newOpacity,a.oldOpacity!==c&&a.placed&&(c?a.show(!0):b=function(){a.hide()},a.alignAttr.opacity=c,a[a.isOld?"animate":"attr"](a.alignAttr,null,b)),a.isOld=!0)})}})(L);(function(a){var B=a.addEvent,A=a.Chart,H=a.createElement,G=a.css,r=a.defaultOptions,g=a.defaultPlotOptions,f=a.each,u=
a.extend,l=a.fireEvent,q=a.hasTouch,d=a.inArray,b=a.isObject,p=a.Legend,C=a.merge,t=a.pick,m=a.Point,c=a.Series,n=a.seriesTypes,E=a.svg;a=a.TrackerMixin={drawTrackerPoint:function(){var a=this,b=a.chart,c=b.pointer,d=function(a){for(var c=a.target,e;c&&!e;)e=c.point,c=c.parentNode;if(void 0!==e&&e!==b.hoverPoint)e.onMouseOver(a)};f(a.points,function(a){a.graphic&&(a.graphic.element.point=a);a.dataLabel&&(a.dataLabel.div?a.dataLabel.div.point=a:a.dataLabel.element.point=a)});a._hasTracking||(f(a.trackerGroups,
function(b){if(a[b]){a[b].addClass("highcharts-tracker").on("mouseover",d).on("mouseout",function(a){c.onTrackerMouseOut(a)});if(q)a[b].on("touchstart",d);a.options.cursor&&a[b].css(G).css({cursor:a.options.cursor})}}),a._hasTracking=!0)},drawTrackerGraph:function(){var a=this,b=a.options,c=b.trackByArea,d=[].concat(c?a.areaPath:a.graphPath),g=d.length,h=a.chart,l=h.pointer,m=h.renderer,n=h.options.tooltip.snap,p=a.tracker,k,r=function(){if(h.hoverSeries!==a)a.onMouseOver()},t="rgba(192,192,192,"+
(E?.0001:.002)+")";if(g&&!c)for(k=g+1;k--;)"M"===d[k]&&d.splice(k+1,0,d[k+1]-n,d[k+2],"L"),(k&&"M"===d[k]||k===g)&&d.splice(k,0,"L",d[k-2]+n,d[k-1]);p?p.attr({d:d}):a.graph&&(a.tracker=m.path(d).attr({"stroke-linejoin":"round",visibility:a.visible?"visible":"hidden",stroke:t,fill:c?t:"none","stroke-width":a.graph.strokeWidth()+(c?0:2*n),zIndex:2}).add(a.group),f([a.tracker,a.markerGroup],function(a){a.addClass("highcharts-tracker").on("mouseover",r).on("mouseout",function(a){l.onTrackerMouseOut(a)});
b.cursor&&a.css({cursor:b.cursor});if(q)a.on("touchstart",r)}))}};n.column&&(n.column.prototype.drawTracker=a.drawTrackerPoint);n.pie&&(n.pie.prototype.drawTracker=a.drawTrackerPoint);n.scatter&&(n.scatter.prototype.drawTracker=a.drawTrackerPoint);u(p.prototype,{setItemEvents:function(a,b,c){var e=this,d=e.chart,f="highcharts-legend-"+(a.series?"point":"series")+"-active";(c?b:a.legendGroup).on("mouseover",function(){a.setState("hover");d.seriesGroup.addClass(f);b.css(e.options.itemHoverStyle)}).on("mouseout",
function(){b.css(a.visible?e.itemStyle:e.itemHiddenStyle);d.seriesGroup.removeClass(f);a.setState()}).on("click",function(b){var c=function(){a.setVisible&&a.setVisible()};b={browserEvent:b};a.firePointEvent?a.firePointEvent("legendItemClick",b,c):l(a,"legendItemClick",b,c)})},createCheckboxForItem:function(a){a.checkbox=H("input",{type:"checkbox",checked:a.selected,defaultChecked:a.selected},this.options.itemCheckboxStyle,this.chart.container);B(a.checkbox,"click",function(b){l(a.series||a,"checkboxClick",
{checked:b.target.checked,item:a},function(){a.select()})})}});r.legend.itemStyle.cursor="pointer";u(A.prototype,{showResetZoom:function(){var a=this,b=r.lang,c=a.options.chart.resetZoomButton,d=c.theme,f=d.states,g="chart"===c.relativeTo?null:"plotBox";this.resetZoomButton=a.renderer.button(b.resetZoom,null,null,function(){a.zoomOut()},d,f&&f.hover).attr({align:c.position.align,title:b.resetZoomTitle}).addClass("highcharts-reset-zoom").add().align(c.position,!1,g)},zoomOut:function(){var a=this;
l(a,"selection",{resetSelection:!0},function(){a.zoom()})},zoom:function(a){var c,d=this.pointer,g=!1,l;!a||a.resetSelection?f(this.axes,function(a){c=a.zoom()}):f(a.xAxis.concat(a.yAxis),function(a){var b=a.axis;d[b.isXAxis?"zoomX":"zoomY"]&&(c=b.zoom(a.min,a.max),b.displayBtn&&(g=!0))});l=this.resetZoomButton;g&&!l?this.showResetZoom():!g&&b(l)&&(this.resetZoomButton=l.destroy());c&&this.redraw(t(this.options.chart.animation,a&&a.animation,100>this.pointCount))},pan:function(a,b){var c=this,d=c.hoverPoints,
e;d&&f(d,function(a){a.setState()});f("xy"===b?[1,0]:[1],function(b){b=c[b?"xAxis":"yAxis"][0];var d=b.horiz,f=a[d?"chartX":"chartY"],d=d?"mouseDownX":"mouseDownY",g=c[d],h=(b.pointRange||0)/2,k=b.getExtremes(),l=b.toValue(g-f,!0)+h,h=b.toValue(g+b.len-f,!0)-h,m=h<l,g=m?h:l,l=m?l:h,h=Math.min(k.dataMin,k.min)-g,k=l-Math.max(k.dataMax,k.max);b.series.length&&0>h&&0>k&&(b.setExtremes(g,l,!1,!1,{trigger:"pan"}),e=!0);c[d]=f});e&&c.redraw(!1);G(c.container,{cursor:"move"})}});u(m.prototype,{select:function(a,
b){var c=this,e=c.series,g=e.chart;a=t(a,!c.selected);c.firePointEvent(a?"select":"unselect",{accumulate:b},function(){c.selected=c.options.selected=a;e.options.data[d(c,e.data)]=c.options;c.setState(a&&"select");b||f(g.getSelectedPoints(),function(a){a.selected&&a!==c&&(a.selected=a.options.selected=!1,e.options.data[d(a,e.data)]=a.options,a.setState(""),a.firePointEvent("unselect"))})})},onMouseOver:function(a,b){var c=this.series,d=c.chart,e=d.tooltip,f=d.hoverPoint;if(this.series){if(!b){if(f&&
f!==this)f.onMouseOut();if(d.hoverSeries!==c)c.onMouseOver();d.hoverPoint=this}!e||e.shared&&!c.noSharedTooltip?e||this.setState("hover"):(this.setState("hover"),e.refresh(this,a));this.firePointEvent("mouseOver")}},onMouseOut:function(){var a=this.series.chart,b=a.hoverPoints;this.firePointEvent("mouseOut");b&&-1!==d(this,b)||(this.setState(),a.hoverPoint=null)},importEvents:function(){if(!this.hasImportedEvents){var a=C(this.series.options.point,this.options).events,b;this.events=a;for(b in a)B(this,
b,a[b]);this.hasImportedEvents=!0}},setState:function(a,b){var c=Math.floor(this.plotX),d=this.plotY,e=this.series,f=e.options.states[a]||{},l=g[e.type].marker&&e.options.marker,m=l&&!1===l.enabled,n=l&&l.states&&l.states[a]||{},p=!1===n.enabled,k=e.stateMarkerGraphic,q=this.marker||{},r=e.chart,z=e.halo,C,A=l&&e.markerAttribs;a=a||"";if(!(a===this.state&&!b||this.selected&&"select"!==a||!1===f.enabled||a&&(p||m&&!1===n.enabled)||a&&q.states&&q.states[a]&&!1===q.states[a].enabled)){A&&(C=e.markerAttribs(this,
a));if(this.graphic)this.state&&this.graphic.removeClass("highcharts-point-"+this.state),a&&this.graphic.addClass("highcharts-point-"+a),this.graphic.attr(e.pointAttribs(this,a)),C&&this.graphic.animate(C,t(r.options.chart.animation,n.animation,l.animation)),k&&k.hide();else{if(a&&n){l=q.symbol||e.symbol;k&&k.currentSymbol!==l&&(k=k.destroy());if(k)k[b?"animate":"attr"]({x:C.x,y:C.y});else l&&(e.stateMarkerGraphic=k=r.renderer.symbol(l,C.x,C.y,C.width,C.height).add(e.markerGroup),k.currentSymbol=
l);k&&k.attr(e.pointAttribs(this,a))}k&&(k[a&&r.isInsidePlot(c,d,r.inverted)?"show":"hide"](),k.element.point=this)}(c=f.halo)&&c.size?(z||(e.halo=z=r.renderer.path().add(A?e.markerGroup:e.group)),z[b?"animate":"attr"]({d:this.haloPath(c.size)}),z.attr({"class":"highcharts-halo highcharts-color-"+t(this.colorIndex,e.colorIndex)}),z.point=this,z.attr(u({fill:this.color||e.color,"fill-opacity":c.opacity,zIndex:-1},c.attributes))):z&&z.point&&z.point.haloPath&&z.animate({d:z.point.haloPath(0)});this.state=
a}},haloPath:function(a){return this.series.chart.renderer.symbols.circle(Math.floor(this.plotX)-a,this.plotY-a,2*a,2*a)}});u(c.prototype,{onMouseOver:function(){var a=this.chart,b=a.hoverSeries;if(b&&b!==this)b.onMouseOut();this.options.events.mouseOver&&l(this,"mouseOver");this.setState("hover");a.hoverSeries=this},onMouseOut:function(){var a=this.options,b=this.chart,c=b.tooltip,d=b.hoverPoint;b.hoverSeries=null;if(d)d.onMouseOut();this&&a.events.mouseOut&&l(this,"mouseOut");!c||a.stickyTracking||
c.shared&&!this.noSharedTooltip||c.hide();this.setState()},setState:function(a){var b=this,c=b.options,d=b.graph,g=c.states,h=c.lineWidth,c=0;a=a||"";if(b.state!==a&&(f([b.group,b.markerGroup],function(c){c&&(b.state&&c.removeClass("highcharts-series-"+b.state),a&&c.addClass("highcharts-series-"+a))}),b.state=a,!g[a]||!1!==g[a].enabled)&&(a&&(h=g[a].lineWidth||h+(g[a].lineWidthPlus||0)),d&&!d.dashstyle))for(g={"stroke-width":h},d.attr(g);b["zone-graph-"+c];)b["zone-graph-"+c].attr(g),c+=1},setVisible:function(a,
b){var c=this,d=c.chart,e=c.legendItem,g,m=d.options.chart.ignoreHiddenSeries,n=c.visible;g=(c.visible=a=c.options.visible=c.userOptions.visible=void 0===a?!n:a)?"show":"hide";f(["group","dataLabelsGroup","markerGroup","tracker","tt"],function(a){if(c[a])c[a][g]()});if(d.hoverSeries===c||(d.hoverPoint&&d.hoverPoint.series)===c)c.onMouseOut();e&&d.legend.colorizeItem(c,a);c.isDirty=!0;c.options.stacking&&f(d.series,function(a){a.options.stacking&&a.visible&&(a.isDirty=!0)});f(c.linkedSeries,function(b){b.setVisible(a,
!1)});m&&(d.isDirtyBox=!0);!1!==b&&d.redraw();l(c,g)},show:function(){this.setVisible(!0)},hide:function(){this.setVisible(!1)},select:function(a){this.selected=a=void 0===a?!this.selected:a;this.checkbox&&(this.checkbox.checked=a);l(this,a?"select":"unselect")},drawTracker:a.drawTrackerGraph})})(L);(function(a){var B=a.Chart,A=a.each,H=a.inArray,G=a.isObject,r=a.pick,g=a.splat;B.prototype.setResponsive=function(a){var f=this.options.responsive;f&&f.rules&&A(f.rules,function(f){this.matchResponsiveRule(f,
a)},this)};B.prototype.matchResponsiveRule=function(f,g){var l=this.respRules,q=f.condition,d;d=q.callback||function(){return this.chartWidth<=r(q.maxWidth,Number.MAX_VALUE)&&this.chartHeight<=r(q.maxHeight,Number.MAX_VALUE)&&this.chartWidth>=r(q.minWidth,0)&&this.chartHeight>=r(q.minHeight,0)};void 0===f._id&&(f._id=a.uniqueKey());d=d.call(this);!l[f._id]&&d?f.chartOptions&&(l[f._id]=this.currentOptions(f.chartOptions),this.update(f.chartOptions,g)):l[f._id]&&!d&&(this.update(l[f._id],g),delete l[f._id])};
B.prototype.currentOptions=function(a){function f(a,d,b,l){var p,q;for(p in a)if(!l&&-1<H(p,["series","xAxis","yAxis"]))for(a[p]=g(a[p]),b[p]=[],q=0;q<a[p].length;q++)b[p][q]={},f(a[p][q],d[p][q],b[p][q],l+1);else G(a[p])?(b[p]={},f(a[p],d[p]||{},b[p],l+1)):b[p]=d[p]||null}var l={};f(a,this.options,l,0);return l}})(L);return L});

define("highcharts", function(){});

/*!
 * Bootstrap Colorpicker v2.5.1
 * https://itsjavi.com/bootstrap-colorpicker/
 *
 * Originally written by (c) 2012 Stefan Petre
 * Licensed under the Apache License v2.0
 * http://www.apache.org/licenses/LICENSE-2.0.txt
 *
 */

(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    // AMD. Register as an anonymous module unless amdModuleId is set
    define('bootstrap-colorpicker',["jquery"], function(jq) {
      return (factory(jq));
    });
  } else if (typeof exports === 'object') {
    // Node. Does not work with strict CommonJS, but
    // only CommonJS-like environments that support module.exports,
    // like Node.
    module.exports = factory(require("jquery"));
  } else if (jQuery && !jQuery.fn.colorpicker) {
    factory(jQuery);
  }
}(this, function($) {
  'use strict';
  /**
   * Color manipulation helper class
   *
   * @param {Object|String} [val]
   * @param {Object} [predefinedColors]
   * @param {String|null} [fallbackColor]
   * @param {String|null} [fallbackFormat]
   * @param {Boolean} [hexNumberSignPrefix]
   * @constructor
   */
  var Color = function(
    val, predefinedColors, fallbackColor, fallbackFormat, hexNumberSignPrefix) {
    this.fallbackValue = fallbackColor ?
      (
        fallbackColor && (typeof fallbackColor.h !== 'undefined') ?
        fallbackColor :
        this.value = {
          h: 0,
          s: 0,
          b: 0,
          a: 1
        }
      ) :
      null;

    this.fallbackFormat = fallbackFormat ? fallbackFormat : 'rgba';

    this.hexNumberSignPrefix = hexNumberSignPrefix === true;

    this.value = this.fallbackValue;

    this.origFormat = null; // original string format

    this.predefinedColors = predefinedColors ? predefinedColors : {};

    // We don't want to share aliases across instances so we extend new object
    this.colors = $.extend({}, Color.webColors, this.predefinedColors);

    if (val) {
      if (typeof val.h !== 'undefined') {
        this.value = val;
      } else {
        this.setColor(String(val));
      }
    }

    if (!this.value) {
      // Initial value is always black if no arguments are passed or val is empty
      this.value = {
        h: 0,
        s: 0,
        b: 0,
        a: 1
      };
    }
  };

  Color.webColors = { // 140 predefined colors from the HTML Colors spec
    "aliceblue": "f0f8ff",
    "antiquewhite": "faebd7",
    "aqua": "00ffff",
    "aquamarine": "7fffd4",
    "azure": "f0ffff",
    "beige": "f5f5dc",
    "bisque": "ffe4c4",
    "black": "000000",
    "blanchedalmond": "ffebcd",
    "blue": "0000ff",
    "blueviolet": "8a2be2",
    "brown": "a52a2a",
    "burlywood": "deb887",
    "cadetblue": "5f9ea0",
    "chartreuse": "7fff00",
    "chocolate": "d2691e",
    "coral": "ff7f50",
    "cornflowerblue": "6495ed",
    "cornsilk": "fff8dc",
    "crimson": "dc143c",
    "cyan": "00ffff",
    "darkblue": "00008b",
    "darkcyan": "008b8b",
    "darkgoldenrod": "b8860b",
    "darkgray": "a9a9a9",
    "darkgreen": "006400",
    "darkkhaki": "bdb76b",
    "darkmagenta": "8b008b",
    "darkolivegreen": "556b2f",
    "darkorange": "ff8c00",
    "darkorchid": "9932cc",
    "darkred": "8b0000",
    "darksalmon": "e9967a",
    "darkseagreen": "8fbc8f",
    "darkslateblue": "483d8b",
    "darkslategray": "2f4f4f",
    "darkturquoise": "00ced1",
    "darkviolet": "9400d3",
    "deeppink": "ff1493",
    "deepskyblue": "00bfff",
    "dimgray": "696969",
    "dodgerblue": "1e90ff",
    "firebrick": "b22222",
    "floralwhite": "fffaf0",
    "forestgreen": "228b22",
    "fuchsia": "ff00ff",
    "gainsboro": "dcdcdc",
    "ghostwhite": "f8f8ff",
    "gold": "ffd700",
    "goldenrod": "daa520",
    "gray": "808080",
    "green": "008000",
    "greenyellow": "adff2f",
    "honeydew": "f0fff0",
    "hotpink": "ff69b4",
    "indianred": "cd5c5c",
    "indigo": "4b0082",
    "ivory": "fffff0",
    "khaki": "f0e68c",
    "lavender": "e6e6fa",
    "lavenderblush": "fff0f5",
    "lawngreen": "7cfc00",
    "lemonchiffon": "fffacd",
    "lightblue": "add8e6",
    "lightcoral": "f08080",
    "lightcyan": "e0ffff",
    "lightgoldenrodyellow": "fafad2",
    "lightgrey": "d3d3d3",
    "lightgreen": "90ee90",
    "lightpink": "ffb6c1",
    "lightsalmon": "ffa07a",
    "lightseagreen": "20b2aa",
    "lightskyblue": "87cefa",
    "lightslategray": "778899",
    "lightsteelblue": "b0c4de",
    "lightyellow": "ffffe0",
    "lime": "00ff00",
    "limegreen": "32cd32",
    "linen": "faf0e6",
    "magenta": "ff00ff",
    "maroon": "800000",
    "mediumaquamarine": "66cdaa",
    "mediumblue": "0000cd",
    "mediumorchid": "ba55d3",
    "mediumpurple": "9370d8",
    "mediumseagreen": "3cb371",
    "mediumslateblue": "7b68ee",
    "mediumspringgreen": "00fa9a",
    "mediumturquoise": "48d1cc",
    "mediumvioletred": "c71585",
    "midnightblue": "191970",
    "mintcream": "f5fffa",
    "mistyrose": "ffe4e1",
    "moccasin": "ffe4b5",
    "navajowhite": "ffdead",
    "navy": "000080",
    "oldlace": "fdf5e6",
    "olive": "808000",
    "olivedrab": "6b8e23",
    "orange": "ffa500",
    "orangered": "ff4500",
    "orchid": "da70d6",
    "palegoldenrod": "eee8aa",
    "palegreen": "98fb98",
    "paleturquoise": "afeeee",
    "palevioletred": "d87093",
    "papayawhip": "ffefd5",
    "peachpuff": "ffdab9",
    "peru": "cd853f",
    "pink": "ffc0cb",
    "plum": "dda0dd",
    "powderblue": "b0e0e6",
    "purple": "800080",
    "red": "ff0000",
    "rosybrown": "bc8f8f",
    "royalblue": "4169e1",
    "saddlebrown": "8b4513",
    "salmon": "fa8072",
    "sandybrown": "f4a460",
    "seagreen": "2e8b57",
    "seashell": "fff5ee",
    "sienna": "a0522d",
    "silver": "c0c0c0",
    "skyblue": "87ceeb",
    "slateblue": "6a5acd",
    "slategray": "708090",
    "snow": "fffafa",
    "springgreen": "00ff7f",
    "steelblue": "4682b4",
    "tan": "d2b48c",
    "teal": "008080",
    "thistle": "d8bfd8",
    "tomato": "ff6347",
    "turquoise": "40e0d0",
    "violet": "ee82ee",
    "wheat": "f5deb3",
    "white": "ffffff",
    "whitesmoke": "f5f5f5",
    "yellow": "ffff00",
    "yellowgreen": "9acd32",
    "transparent": "transparent"
  };

  Color.prototype = {
    constructor: Color,
    colors: {}, // merged web and predefined colors
    predefinedColors: {},
    /**
     * @return {Object}
     */
    getValue: function() {
      return this.value;
    },
    /**
     * @param {Object} val
     */
    setValue: function(val) {
      this.value = val;
    },
    _sanitizeNumber: function(val) {
      if (typeof val === 'number') {
        return val;
      }
      if (isNaN(val) || (val === null) || (val === '') || (val === undefined)) {
        return 1;
      }
      if (val === '') {
        return 0;
      }
      if (typeof val.toLowerCase !== 'undefined') {
        if (val.match(/^\./)) {
          val = "0" + val;
        }
        return Math.ceil(parseFloat(val) * 100) / 100;
      }
      return 1;
    },
    isTransparent: function(strVal) {
      if (!strVal || !(typeof strVal === 'string' || strVal instanceof String)) {
        return false;
      }
      strVal = strVal.toLowerCase().trim();
      return (strVal === 'transparent') || (strVal.match(/#?00000000/)) || (strVal.match(/(rgba|hsla)\(0,0,0,0?\.?0\)/));
    },
    rgbaIsTransparent: function(rgba) {
      return ((rgba.r === 0) && (rgba.g === 0) && (rgba.b === 0) && (rgba.a === 0));
    },
    // parse a string to HSB
    /**
     * @protected
     * @param {String} strVal
     * @returns {boolean} Returns true if it could be parsed, false otherwise
     */
    setColor: function(strVal) {
      strVal = strVal.toLowerCase().trim();
      if (strVal) {
        if (this.isTransparent(strVal)) {
          this.value = {
            h: 0,
            s: 0,
            b: 0,
            a: 0
          };
          return true;
        } else {
          var parsedColor = this.parse(strVal);
          if (parsedColor) {
            this.value = this.value = {
              h: parsedColor.h,
              s: parsedColor.s,
              b: parsedColor.b,
              a: parsedColor.a
            };
            if (!this.origFormat) {
              this.origFormat = parsedColor.format;
            }
          } else if (this.fallbackValue) {
            // if parser fails, defaults to fallbackValue if defined, otherwise the value won't be changed
            this.value = this.fallbackValue;
          }
        }
      }
      return false;
    },
    setHue: function(h) {
      this.value.h = 1 - h;
    },
    setSaturation: function(s) {
      this.value.s = s;
    },
    setBrightness: function(b) {
      this.value.b = 1 - b;
    },
    setAlpha: function(a) {
      this.value.a = Math.round((parseInt((1 - a) * 100, 10) / 100) * 100) / 100;
    },
    toRGB: function(h, s, b, a) {
      if (arguments.length === 0) {
        h = this.value.h;
        s = this.value.s;
        b = this.value.b;
        a = this.value.a;
      }

      h *= 360;
      var R, G, B, X, C;
      h = (h % 360) / 60;
      C = b * s;
      X = C * (1 - Math.abs(h % 2 - 1));
      R = G = B = b - C;

      h = ~~h;
      R += [C, X, 0, 0, X, C][h];
      G += [X, C, C, X, 0, 0][h];
      B += [0, 0, X, C, C, X][h];

      return {
        r: Math.round(R * 255),
        g: Math.round(G * 255),
        b: Math.round(B * 255),
        a: a
      };
    },
    toHex: function(h, s, b, a) {
      if (arguments.length === 0) {
        h = this.value.h;
        s = this.value.s;
        b = this.value.b;
        a = this.value.a;
      }

      var rgb = this.toRGB(h, s, b, a);

      if (this.rgbaIsTransparent(rgb)) {
        return 'transparent';
      }

      var hexStr = (this.hexNumberSignPrefix ? '#' : '') + (
          (1 << 24) +
          (parseInt(rgb.r) << 16) +
          (parseInt(rgb.g) << 8) +
          parseInt(rgb.b))
        .toString(16)
        .slice(1);

      return hexStr;
    },
    toHSL: function(h, s, b, a) {
      if (arguments.length === 0) {
        h = this.value.h;
        s = this.value.s;
        b = this.value.b;
        a = this.value.a;
      }

      var H = h,
        L = (2 - s) * b,
        S = s * b;
      if (L > 0 && L <= 1) {
        S /= L;
      } else {
        S /= 2 - L;
      }
      L /= 2;
      if (S > 1) {
        S = 1;
      }
      return {
        h: isNaN(H) ? 0 : H,
        s: isNaN(S) ? 0 : S,
        l: isNaN(L) ? 0 : L,
        a: isNaN(a) ? 0 : a
      };
    },
    toAlias: function(r, g, b, a) {
      var c, rgb = (arguments.length === 0) ? this.toHex() : this.toHex(r, g, b, a);

      // support predef. colors in non-hex format too, as defined in the alias itself
      var original = this.origFormat === 'alias' ? rgb : this.toString(this.origFormat, false);

      for (var alias in this.colors) {
        c = this.colors[alias].toLowerCase().trim();
        if ((c === rgb) || (c === original)) {
          return alias;
        }
      }
      return false;
    },
    RGBtoHSB: function(r, g, b, a) {
      r /= 255;
      g /= 255;
      b /= 255;

      var H, S, V, C;
      V = Math.max(r, g, b);
      C = V - Math.min(r, g, b);
      H = (C === 0 ? null :
        V === r ? (g - b) / C :
        V === g ? (b - r) / C + 2 :
        (r - g) / C + 4
      );
      H = ((H + 360) % 6) * 60 / 360;
      S = C === 0 ? 0 : C / V;
      return {
        h: this._sanitizeNumber(H),
        s: S,
        b: V,
        a: this._sanitizeNumber(a)
      };
    },
    HueToRGB: function(p, q, h) {
      if (h < 0) {
        h += 1;
      } else if (h > 1) {
        h -= 1;
      }
      if ((h * 6) < 1) {
        return p + (q - p) * h * 6;
      } else if ((h * 2) < 1) {
        return q;
      } else if ((h * 3) < 2) {
        return p + (q - p) * ((2 / 3) - h) * 6;
      } else {
        return p;
      }
    },
    HSLtoRGB: function(h, s, l, a) {
      if (s < 0) {
        s = 0;
      }
      var q;
      if (l <= 0.5) {
        q = l * (1 + s);
      } else {
        q = l + s - (l * s);
      }

      var p = 2 * l - q;

      var tr = h + (1 / 3);
      var tg = h;
      var tb = h - (1 / 3);

      var r = Math.round(this.HueToRGB(p, q, tr) * 255);
      var g = Math.round(this.HueToRGB(p, q, tg) * 255);
      var b = Math.round(this.HueToRGB(p, q, tb) * 255);
      return [r, g, b, this._sanitizeNumber(a)];
    },
    /**
     * @param {String} strVal
     * @returns {Object} Object containing h,s,b,a,format properties or FALSE if failed to parse
     */
    parse: function(strVal) {
      if (arguments.length === 0) {
        return false;
      }

      var that = this,
        result = false,
        isAlias = (typeof this.colors[strVal] !== 'undefined'),
        values, format;

      if (isAlias) {
        strVal = this.colors[strVal].toLowerCase().trim();
      }

      $.each(this.stringParsers, function(i, parser) {
        var match = parser.re.exec(strVal);
        values = match && parser.parse.apply(that, [match]);
        if (values) {
          result = {};
          format = (isAlias ? 'alias' : (parser.format ? parser.format : that.getValidFallbackFormat()));
          if (format.match(/hsla?/)) {
            result = that.RGBtoHSB.apply(that, that.HSLtoRGB.apply(that, values));
          } else {
            result = that.RGBtoHSB.apply(that, values);
          }
          if (result instanceof Object) {
            result.format = format;
          }
          return false; // stop iterating
        }
        return true;
      });
      return result;
    },
    getValidFallbackFormat: function() {
      var formats = [
        'rgba', 'rgb', 'hex', 'hsla', 'hsl'
      ];
      if (this.origFormat && (formats.indexOf(this.origFormat) !== -1)) {
        return this.origFormat;
      }
      if (this.fallbackFormat && (formats.indexOf(this.fallbackFormat) !== -1)) {
        return this.fallbackFormat;
      }

      return 'rgba'; // By default, return a format that will not lose the alpha info
    },
    /**
     *
     * @param {string} [format] (default: rgba)
     * @param {boolean} [translateAlias] Return real color for pre-defined (non-standard) aliases (default: false)
     * @returns {String}
     */
    toString: function(format, translateAlias) {
      format = format || this.origFormat || this.fallbackFormat;
      translateAlias = translateAlias || false;

      var c = false;

      switch (format) {
        case 'rgb':
          {
            c = this.toRGB();
            if (this.rgbaIsTransparent(c)) {
              return 'transparent';
            }
            return 'rgb(' + c.r + ',' + c.g + ',' + c.b + ')';
          }
          break;
        case 'rgba':
          {
            c = this.toRGB();
            return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + c.a + ')';
          }
          break;
        case 'hsl':
          {
            c = this.toHSL();
            return 'hsl(' + Math.round(c.h * 360) + ',' + Math.round(c.s * 100) + '%,' + Math.round(c.l * 100) + '%)';
          }
          break;
        case 'hsla':
          {
            c = this.toHSL();
            return 'hsla(' + Math.round(c.h * 360) + ',' + Math.round(c.s * 100) + '%,' + Math.round(c.l * 100) + '%,' + c.a + ')';
          }
          break;
        case 'hex':
          {
            return this.toHex();
          }
          break;
        case 'alias':
          {
            c = this.toAlias();

            if (c === false) {
              return this.toString(this.getValidFallbackFormat());
            }

            if (translateAlias && !(c in Color.webColors) && (c in this.predefinedColors)) {
              return this.predefinedColors[c];
            }

            return c;
          }
        default:
          {
            return c;
          }
          break;
      }
    },
    // a set of RE's that can match strings and generate color tuples.
    // from John Resig color plugin
    // https://github.com/jquery/jquery-color/
    stringParsers: [{
      re: /rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*?\)/,
      format: 'rgb',
      parse: function(execResult) {
        return [
          execResult[1],
          execResult[2],
          execResult[3],
          1
        ];
      }
    }, {
      re: /rgb\(\s*(\d*(?:\.\d+)?)\%\s*,\s*(\d*(?:\.\d+)?)\%\s*,\s*(\d*(?:\.\d+)?)\%\s*?\)/,
      format: 'rgb',
      parse: function(execResult) {
        return [
          2.55 * execResult[1],
          2.55 * execResult[2],
          2.55 * execResult[3],
          1
        ];
      }
    }, {
      re: /rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(\d*(?:\.\d+)?)\s*)?\)/,
      format: 'rgba',
      parse: function(execResult) {
        return [
          execResult[1],
          execResult[2],
          execResult[3],
          execResult[4]
        ];
      }
    }, {
      re: /rgba\(\s*(\d*(?:\.\d+)?)\%\s*,\s*(\d*(?:\.\d+)?)\%\s*,\s*(\d*(?:\.\d+)?)\%\s*(?:,\s*(\d*(?:\.\d+)?)\s*)?\)/,
      format: 'rgba',
      parse: function(execResult) {
        return [
          2.55 * execResult[1],
          2.55 * execResult[2],
          2.55 * execResult[3],
          execResult[4]
        ];
      }
    }, {
      re: /hsl\(\s*(\d*(?:\.\d+)?)\s*,\s*(\d*(?:\.\d+)?)\%\s*,\s*(\d*(?:\.\d+)?)\%\s*?\)/,
      format: 'hsl',
      parse: function(execResult) {
        return [
          execResult[1] / 360,
          execResult[2] / 100,
          execResult[3] / 100,
          execResult[4]
        ];
      }
    }, {
      re: /hsla\(\s*(\d*(?:\.\d+)?)\s*,\s*(\d*(?:\.\d+)?)\%\s*,\s*(\d*(?:\.\d+)?)\%\s*(?:,\s*(\d*(?:\.\d+)?)\s*)?\)/,
      format: 'hsla',
      parse: function(execResult) {
        return [
          execResult[1] / 360,
          execResult[2] / 100,
          execResult[3] / 100,
          execResult[4]
        ];
      }
    }, {
      re: /#?([a-fA-F0-9]{2})([a-fA-F0-9]{2})([a-fA-F0-9]{2})/,
      format: 'hex',
      parse: function(execResult) {
        return [
          parseInt(execResult[1], 16),
          parseInt(execResult[2], 16),
          parseInt(execResult[3], 16),
          1
        ];
      }
    }, {
      re: /#?([a-fA-F0-9])([a-fA-F0-9])([a-fA-F0-9])/,
      format: 'hex',
      parse: function(execResult) {
        return [
          parseInt(execResult[1] + execResult[1], 16),
          parseInt(execResult[2] + execResult[2], 16),
          parseInt(execResult[3] + execResult[3], 16),
          1
        ];
      }
    }],
    colorNameToHex: function(name) {
      if (typeof this.colors[name.toLowerCase()] !== 'undefined') {
        return this.colors[name.toLowerCase()];
      }
      return false;
    }
  };

  /*
   * Default plugin options
   */
  var defaults = {
    horizontal: false, // horizontal mode layout ?
    inline: false, //forces to show the colorpicker as an inline element
    color: false, //forces a color
    format: false, //forces a format
    input: 'input', // children input selector
    container: false, // container selector
    component: '.add-on, .input-group-addon', // children component selector
    fallbackColor: false, // fallback color value. null = keeps current color.
    fallbackFormat: 'hex', // fallback color format
    hexNumberSignPrefix: true, // put a '#' (number sign) before hex strings
    sliders: {
      saturation: {
        maxLeft: 100,
        maxTop: 100,
        callLeft: 'setSaturation',
        callTop: 'setBrightness'
      },
      hue: {
        maxLeft: 0,
        maxTop: 100,
        callLeft: false,
        callTop: 'setHue'
      },
      alpha: {
        maxLeft: 0,
        maxTop: 100,
        callLeft: false,
        callTop: 'setAlpha'
      }
    },
    slidersHorz: {
      saturation: {
        maxLeft: 100,
        maxTop: 100,
        callLeft: 'setSaturation',
        callTop: 'setBrightness'
      },
      hue: {
        maxLeft: 100,
        maxTop: 0,
        callLeft: 'setHue',
        callTop: false
      },
      alpha: {
        maxLeft: 100,
        maxTop: 0,
        callLeft: 'setAlpha',
        callTop: false
      }
    },
    template: '<div class="colorpicker dropdown-menu">' +
      '<div class="colorpicker-saturation"><i><b></b></i></div>' +
      '<div class="colorpicker-hue"><i></i></div>' +
      '<div class="colorpicker-alpha"><i></i></div>' +
      '<div class="colorpicker-color"><div /></div>' +
      '<div class="colorpicker-selectors"></div>' +
      '</div>',
    align: 'right',
    customClass: null, // custom class added to the colorpicker element
    colorSelectors: null // custom color aliases
  };

  /**
   * Colorpicker component class
   *
   * @param {Object|String} element
   * @param {Object} options
   * @constructor
   */
  var Colorpicker = function(element, options) {
    this.element = $(element).addClass('colorpicker-element');
    this.options = $.extend(true, {}, defaults, this.element.data(), options);
    this.component = this.options.component;
    this.component = (this.component !== false) ? this.element.find(this.component) : false;
    if (this.component && (this.component.length === 0)) {
      this.component = false;
    }
    this.container = (this.options.container === true) ? this.element : this.options.container;
    this.container = (this.container !== false) ? $(this.container) : false;

    // Is the element an input? Should we search inside for any input?
    this.input = this.element.is('input') ? this.element : (this.options.input ?
      this.element.find(this.options.input) : false);
    if (this.input && (this.input.length === 0)) {
      this.input = false;
    }
    // Set HSB color
    this.color = this.createColor(this.options.color !== false ? this.options.color : this.getValue());

    this.format = this.options.format !== false ? this.options.format : this.color.origFormat;

    if (this.options.color !== false) {
      this.updateInput(this.color);
      this.updateData(this.color);
    }

    // Setup picker
    var $picker = this.picker = $(this.options.template);
    if (this.options.customClass) {
      $picker.addClass(this.options.customClass);
    }
    if (this.options.inline) {
      $picker.addClass('colorpicker-inline colorpicker-visible');
    } else {
      $picker.addClass('colorpicker-hidden');
    }
    if (this.options.horizontal) {
      $picker.addClass('colorpicker-horizontal');
    }
    if (
      (['rgba', 'hsla', 'alias'].indexOf(this.format) !== -1) ||
      this.options.format === false ||
      this.getValue() === 'transparent'
    ) {
      $picker.addClass('colorpicker-with-alpha');
    }
    if (this.options.align === 'right') {
      $picker.addClass('colorpicker-right');
    }
    if (this.options.inline === true) {
      $picker.addClass('colorpicker-no-arrow');
    }
    if (this.options.colorSelectors) {
      var colorpicker = this,
        selectorsContainer = colorpicker.picker.find('.colorpicker-selectors');

      if (selectorsContainer.length > 0) {
        $.each(this.options.colorSelectors, function(name, color) {
          var $btn = $('<i />')
            .addClass('colorpicker-selectors-color')
            .css('background-color', color)
            .data('class', name).data('alias', name);

          $btn.on('mousedown.colorpicker touchstart.colorpicker', function(event) {
            event.preventDefault();
            colorpicker.setValue(
              colorpicker.format === 'alias' ? $(this).data('alias') : $(this).css('background-color')
            );
          });
          selectorsContainer.append($btn);
        });
        selectorsContainer.show().addClass('colorpicker-visible');
      }
    }

    // Prevent closing the colorpicker when clicking on itself
    $picker.on('mousedown.colorpicker touchstart.colorpicker', $.proxy(function(e) {
      if (e.target === e.currentTarget) {
        e.preventDefault();
      }
    }, this));

    // Bind click/tap events on the sliders
    $picker.find('.colorpicker-saturation, .colorpicker-hue, .colorpicker-alpha')
      .on('mousedown.colorpicker touchstart.colorpicker', $.proxy(this.mousedown, this));

    $picker.appendTo(this.container ? this.container : $('body'));

    // Bind other events
    if (this.input !== false) {
      this.input.on({
        'keyup.colorpicker': $.proxy(this.keyup, this)
      });
      this.input.on({
        'change.colorpicker': $.proxy(this.change, this)
      });
      if (this.component === false) {
        this.element.on({
          'focus.colorpicker': $.proxy(this.show, this)
        });
      }
      if (this.options.inline === false) {
        this.element.on({
          'focusout.colorpicker': $.proxy(this.hide, this)
        });
      }
    }

    if (this.component !== false) {
      this.component.on({
        'click.colorpicker': $.proxy(this.show, this)
      });
    }

    if ((this.input === false) && (this.component === false)) {
      this.element.on({
        'click.colorpicker': $.proxy(this.show, this)
      });
    }

    // for HTML5 input[type='color']
    if ((this.input !== false) && (this.component !== false) && (this.input.attr('type') === 'color')) {

      this.input.on({
        'click.colorpicker': $.proxy(this.show, this),
        'focus.colorpicker': $.proxy(this.show, this)
      });
    }
    this.update();

    $($.proxy(function() {
      this.element.trigger('create');
    }, this));
  };

  Colorpicker.Color = Color;

  Colorpicker.prototype = {
    constructor: Colorpicker,
    destroy: function() {
      this.picker.remove();
      this.element.removeData('colorpicker', 'color').off('.colorpicker');
      if (this.input !== false) {
        this.input.off('.colorpicker');
      }
      if (this.component !== false) {
        this.component.off('.colorpicker');
      }
      this.element.removeClass('colorpicker-element');
      this.element.trigger({
        type: 'destroy'
      });
    },
    reposition: function() {
      if (this.options.inline !== false || this.options.container) {
        return false;
      }
      var type = this.container && this.container[0] !== window.document.body ? 'position' : 'offset';
      var element = this.component || this.element;
      var offset = element[type]();
      if (this.options.align === 'right') {
        offset.left -= this.picker.outerWidth() - element.outerWidth();
      }
      this.picker.css({
        top: offset.top + element.outerHeight(),
        left: offset.left
      });
    },
    show: function(e) {
      if (this.isDisabled()) {
        // Don't show the widget if it's disabled (the input)
        return;
      }
      this.picker.addClass('colorpicker-visible').removeClass('colorpicker-hidden');
      this.reposition();
      $(window).on('resize.colorpicker', $.proxy(this.reposition, this));
      if (e && (!this.hasInput() || this.input.attr('type') === 'color')) {
        if (e.stopPropagation && e.preventDefault) {
          e.stopPropagation();
          e.preventDefault();
        }
      }
      if ((this.component || !this.input) && (this.options.inline === false)) {
        $(window.document).on({
          'mousedown.colorpicker': $.proxy(this.hide, this)
        });
      }
      this.element.trigger({
        type: 'showPicker',
        color: this.color
      });
    },
    hide: function(e) {
      if ((typeof e !== 'undefined') && e.target) {
        // Prevent hide if triggered by an event and an element inside the colorpicker has been clicked/touched
        if (
          $(e.currentTarget).parents('.colorpicker').length > 0 ||
          $(e.target).parents('.colorpicker').length > 0
        ) {
          return false;
        }
      }
      this.picker.addClass('colorpicker-hidden').removeClass('colorpicker-visible');
      $(window).off('resize.colorpicker', this.reposition);
      $(window.document).off({
        'mousedown.colorpicker': this.hide
      });
      this.update();
      this.element.trigger({
        type: 'hidePicker',
        color: this.color
      });
    },
    updateData: function(val) {
      val = val || this.color.toString(this.format, false);
      this.element.data('color', val);
      return val;
    },
    updateInput: function(val) {
      val = val || this.color.toString(this.format, false);
      if (this.input !== false) {
        this.input.prop('value', val);
        this.input.trigger('change');
      }
      return val;
    },
    updatePicker: function(val) {
      if (typeof val !== 'undefined') {
        this.color = this.createColor(val);
      }
      var sl = (this.options.horizontal === false) ? this.options.sliders : this.options.slidersHorz;
      var icns = this.picker.find('i');
      if (icns.length === 0) {
        return;
      }
      if (this.options.horizontal === false) {
        sl = this.options.sliders;
        icns.eq(1).css('top', sl.hue.maxTop * (1 - this.color.value.h)).end()
          .eq(2).css('top', sl.alpha.maxTop * (1 - this.color.value.a));
      } else {
        sl = this.options.slidersHorz;
        icns.eq(1).css('left', sl.hue.maxLeft * (1 - this.color.value.h)).end()
          .eq(2).css('left', sl.alpha.maxLeft * (1 - this.color.value.a));
      }
      icns.eq(0).css({
        'top': sl.saturation.maxTop - this.color.value.b * sl.saturation.maxTop,
        'left': this.color.value.s * sl.saturation.maxLeft
      });

      this.picker.find('.colorpicker-saturation')
        .css('backgroundColor', (this.options.hexNumberSignPrefix ? '' : '#') + this.color.toHex(this.color.value.h, 1, 1, 1));

      this.picker.find('.colorpicker-alpha')
        .css('backgroundColor', (this.options.hexNumberSignPrefix ? '' : '#') + this.color.toHex());

      this.picker.find('.colorpicker-color, .colorpicker-color div')
        .css('backgroundColor', this.color.toString(this.format, true));

      return val;
    },
    updateComponent: function(val) {
      var color;

      if (typeof val !== 'undefined') {
        color = this.createColor(val);
      } else {
        color = this.color;
      }

      if (this.component !== false) {
        var icn = this.component.find('i').eq(0);
        if (icn.length > 0) {
          icn.css({
            'backgroundColor': color.toString(this.format, true)
          });
        } else {
          this.component.css({
            'backgroundColor': color.toString(this.format, true)
          });
        }
      }

      return color.toString(this.format, false);
    },
    update: function(force) {
      var val;
      if ((this.getValue(false) !== false) || (force === true)) {
        // Update input/data only if the current value is not empty
        val = this.updateComponent();
        this.updateInput(val);
        this.updateData(val);
        this.updatePicker(); // only update picker if value is not empty
      }
      return val;

    },
    setValue: function(val) { // set color manually
      this.color = this.createColor(val);
      this.update(true);
      this.element.trigger({
        type: 'changeColor',
        color: this.color,
        value: val
      });
    },
    /**
     * Creates a new color using the instance options
     * @protected
     * @param {String} val
     * @returns {Color}
     */
    createColor: function(val) {
      return new Color(
        val ? val : null,
        this.options.colorSelectors,
        this.options.fallbackColor ? this.options.fallbackColor : this.color,
        this.options.fallbackFormat,
        this.options.hexNumberSignPrefix
      );
    },
    getValue: function(defaultValue) {
      defaultValue = (typeof defaultValue === 'undefined') ? this.options.fallbackColor : defaultValue;
      var val;
      if (this.hasInput()) {
        val = this.input.val();
      } else {
        val = this.element.data('color');
      }
      if ((val === undefined) || (val === '') || (val === null)) {
        // if not defined or empty, return default
        val = defaultValue;
      }
      return val;
    },
    hasInput: function() {
      return (this.input !== false);
    },
    isDisabled: function() {
      if (this.hasInput()) {
        return (this.input.prop('disabled') === true);
      }
      return false;
    },
    disable: function() {
      if (this.hasInput()) {
        this.input.prop('disabled', true);
        this.element.trigger({
          type: 'disable',
          color: this.color,
          value: this.getValue()
        });
        return true;
      }
      return false;
    },
    enable: function() {
      if (this.hasInput()) {
        this.input.prop('disabled', false);
        this.element.trigger({
          type: 'enable',
          color: this.color,
          value: this.getValue()
        });
        return true;
      }
      return false;
    },
    currentSlider: null,
    mousePointer: {
      left: 0,
      top: 0
    },
    mousedown: function(e) {
      if (!e.pageX && !e.pageY && e.originalEvent && e.originalEvent.touches) {
        e.pageX = e.originalEvent.touches[0].pageX;
        e.pageY = e.originalEvent.touches[0].pageY;
      }
      e.stopPropagation();
      e.preventDefault();

      var target = $(e.target);

      //detect the slider and set the limits and callbacks
      var zone = target.closest('div');
      var sl = this.options.horizontal ? this.options.slidersHorz : this.options.sliders;
      if (!zone.is('.colorpicker')) {
        if (zone.is('.colorpicker-saturation')) {
          this.currentSlider = $.extend({}, sl.saturation);
        } else if (zone.is('.colorpicker-hue')) {
          this.currentSlider = $.extend({}, sl.hue);
        } else if (zone.is('.colorpicker-alpha')) {
          this.currentSlider = $.extend({}, sl.alpha);
        } else {
          return false;
        }
        var offset = zone.offset();
        //reference to guide's style
        this.currentSlider.guide = zone.find('i')[0].style;
        this.currentSlider.left = e.pageX - offset.left;
        this.currentSlider.top = e.pageY - offset.top;
        this.mousePointer = {
          left: e.pageX,
          top: e.pageY
        };
        //trigger mousemove to move the guide to the current position
        $(window.document).on({
          'mousemove.colorpicker': $.proxy(this.mousemove, this),
          'touchmove.colorpicker': $.proxy(this.mousemove, this),
          'mouseup.colorpicker': $.proxy(this.mouseup, this),
          'touchend.colorpicker': $.proxy(this.mouseup, this)
        }).trigger('mousemove');
      }
      return false;
    },
    mousemove: function(e) {
      if (!e.pageX && !e.pageY && e.originalEvent && e.originalEvent.touches) {
        e.pageX = e.originalEvent.touches[0].pageX;
        e.pageY = e.originalEvent.touches[0].pageY;
      }
      e.stopPropagation();
      e.preventDefault();
      var left = Math.max(
        0,
        Math.min(
          this.currentSlider.maxLeft,
          this.currentSlider.left + ((e.pageX || this.mousePointer.left) - this.mousePointer.left)
        )
      );
      var top = Math.max(
        0,
        Math.min(
          this.currentSlider.maxTop,
          this.currentSlider.top + ((e.pageY || this.mousePointer.top) - this.mousePointer.top)
        )
      );
      this.currentSlider.guide.left = left + 'px';
      this.currentSlider.guide.top = top + 'px';
      if (this.currentSlider.callLeft) {
        this.color[this.currentSlider.callLeft].call(this.color, left / this.currentSlider.maxLeft);
      }
      if (this.currentSlider.callTop) {
        this.color[this.currentSlider.callTop].call(this.color, top / this.currentSlider.maxTop);
      }
      // Change format dynamically
      // Only occurs if user choose the dynamic format by
      // setting option format to false
      if (
        this.options.format === false &&
        (this.currentSlider.callTop === 'setAlpha' ||
          this.currentSlider.callLeft === 'setAlpha')
      ) {

        // Converting from hex / rgb to rgba
        if (this.color.value.a !== 1) {
          this.format = 'rgba';
          this.color.origFormat = 'rgba';
        }

        // Converting from rgba to hex
        else {
          this.format = 'hex';
          this.color.origFormat = 'hex';
        }
      }
      this.update(true);

      this.element.trigger({
        type: 'changeColor',
        color: this.color
      });
      return false;
    },
    mouseup: function(e) {
      e.stopPropagation();
      e.preventDefault();
      $(window.document).off({
        'mousemove.colorpicker': this.mousemove,
        'touchmove.colorpicker': this.mousemove,
        'mouseup.colorpicker': this.mouseup,
        'touchend.colorpicker': this.mouseup
      });
      return false;
    },
    change: function(e) {
      this.keyup(e);
    },
    keyup: function(e) {
      if ((e.keyCode === 38)) {
        if (this.color.value.a < 1) {
          this.color.value.a = Math.round((this.color.value.a + 0.01) * 100) / 100;
        }
        this.update(true);
      } else if ((e.keyCode === 40)) {
        if (this.color.value.a > 0) {
          this.color.value.a = Math.round((this.color.value.a - 0.01) * 100) / 100;
        }
        this.update(true);
      } else {
        this.color = this.createColor(this.input.val());
        // Change format dynamically
        // Only occurs if user choose the dynamic format by
        // setting option format to false
        if (this.color.origFormat && this.options.format === false) {
          this.format = this.color.origFormat;
        }
        if (this.getValue(false) !== false) {
          this.updateData();
          this.updateComponent();
          this.updatePicker();
        }
      }
      this.element.trigger({
        type: 'changeColor',
        color: this.color,
        value: this.input.val()
      });
    }
  };

  $.colorpicker = Colorpicker;

  $.fn.colorpicker = function(option) {
    var apiArgs = Array.prototype.slice.call(arguments, 1),
      isSingleElement = (this.length === 1),
      returnValue = null;

    var $jq = this.each(function() {
      var $this = $(this),
        inst = $this.data('colorpicker'),
        options = ((typeof option === 'object') ? option : {});

      if (!inst) {
        inst = new Colorpicker(this, options);
        $this.data('colorpicker', inst);
      }

      if (typeof option === 'string') {
        if ($.isFunction(inst[option])) {
          returnValue = inst[option].apply(inst, apiArgs);
        } else { // its a property ?
          if (apiArgs.length) {
            // set property
            inst[option] = apiArgs[0];
          }
          returnValue = inst[option];
        }
      } else {
        returnValue = $this;
      }
    });
    return isSingleElement ? returnValue : $jq;
  };

  $.fn.colorpicker.constructor = Colorpicker;

}));

define('net/meisen/general/date/DateLibrary',[], function () {

    /*
     * Default constructor...
     */
    var DateLibrary = function () {
    };

    /**
     * Static function useful to generate UTC dates. The parameters are optional,
     * i.e. can be null or undefined. If not specified the date-information will be
     * set to today, whereby the time-information will be set to 0 if not specified.
     */
    DateLibrary.createUTC = function (y, m, d, h, mi, s, ms) {
        var now = new Date();

        y = typeof(y) == 'undefined' || y == null ? now.getFullYear() : y;
        m = typeof(m) == 'undefined' || m == null ? now.getMonth() : m - 1;
        d = typeof(d) == 'undefined' || d == null ? now.getDate() : d;

        h = typeof(h) == 'undefined' || h == null ? 0 : h;
        mi = typeof(mi) == 'undefined' || mi == null ? 0 : mi;
        s = typeof(s) == 'undefined' || s == null ? 0 : s;
        ms = typeof(ms) == 'undefined' || ms == null ? 0 : ms;

        return new Date(Date.UTC(y, m, d, h, mi, s, ms));
    };

    /**
     * Static function used to truncate a date on a specific level.
     */
    DateLibrary.truncateUTC = function (date, level) {
        level = DateLibrary.normalizeLevel(level);
        var res = new Date(date.getTime());
        res.setUTCMilliseconds(0);

        //noinspection FallThroughInSwitchStatementJS
        switch (level) {
            case 'y':
                res.setUTCFullYear(0);
            case 'm':
                res.setUTCMonth(0);
            case 'd':
                res.setUTCDate(1);
            case 'h':
                res.setUTCHours(0);
            case 'mi':
                res.setUTCMinutes(0);
            case 's':
                res.setUTCSeconds(0);
                break;
        }

        return res;
    };

    DateLibrary.modifyUTC = function (date, amount, level, exact) {

        if (amount == 0) {
            return date;
        }

        exact = typeof(exact) == 'undefined' || exact == null ? false : exact;
        level = DateLibrary.normalizeLevel(level);

        var res;
        if (exact) {
            var sign = amount < 0 ? -1 : 1;

            if (level == 'y') {
                /*
                 * Instead of using a multiplier like:
                 *   multiplier *= DateLibrary.numberOfDays(res.getUTCFullYear());
                 * we use the month implementation. This ensures that 0.5 adds 6 months,
                 * instead of the half amount of days. This is more intuitive, someone
                 * will expect the middle of the year to be after 6 months and not after
                 * 182.5 (or 183) days.
                 */
                return DateLibrary.modifyUTC(date, amount * 12, 'm', true);
            } else if (level == 'm') {
                /*
                 * This is more or less the most complicated part of the distance.
                 * We cannot just add the month, the month depends on the current
                 * amount of days within the month, i.e. January +1 means +31 days
                 * on February +1 means +28 days (or even +29). Therefore the distance
                 * depends on the date and the distance to the edge of the month.
                 * Additionally the target month must be especially handled.
                 */
                var edgeDate = DateLibrary.getEdgeDate(date, sign);
                var orgMonthDays = DateLibrary.numberOfDays(date.getUTCFullYear(), date.getUTCMonth() + 1);
                var normDistToEdge = DateLibrary.getDistanceToEdge(date, edgeDate) / orgMonthDays;

                // there is not enough amount to move, so just move within the month
                if (Math.abs(amount) < Math.abs(normDistToEdge)) {
                    return DateLibrary.modifyUTC(date, amount * orgMonthDays, 'd', true);
                }
                // change the amount to be still moved, sign determines the direction
                else {
                    amount -= normDistToEdge;
                }

                date = edgeDate;
            }

            // get the base and the remainder
            var base = Math.floor(amount);
            var remainder = amount - base;

            // calculate the date based on the base
            res = DateLibrary.modifyUTC(date, base, level, false);

            // determine the multiplier
            var multiplier = 1;

            //noinspection FallThroughInSwitchStatementJS
            switch (level) {
                case 'm':
                    var destMonthDays = DateLibrary.numberOfDays(res.getUTCFullYear(), res.getUTCMonth() + 1);
                    multiplier *= destMonthDays;
                case 'd':
                    multiplier *= 24;
                case 'h':
                    multiplier *= 60;
                case 'mi':
                    multiplier *= 60;
                case 's':
                    multiplier *= 1000;
                    break;
            }

            // use the multiplier and calculate the date on milliseconds
            res = new Date(res.getTime() + remainder * multiplier);
        } else {
            res = new Date(date.getTime());

            switch (level) {
                case 'y':
                    res.setUTCFullYear(date.getUTCFullYear() + amount);
                    break;
                case 'm':
                    res.setUTCMonth(date.getUTCMonth() + amount);
                    break;
                case 'd':
                    res.setUTCDate(date.getUTCDate() + amount);
                    break;
                case 'h':
                    res.setUTCHours(date.getUTCHours() + amount);
                    break;
                case 'mi':
                    res.setUTCMinutes(date.getUTCMinutes() + amount);
                    break;
                case 's':
                    res.setUTCSeconds(date.getUTCSeconds() + amount);
                    break;
            }
        }

        return res;
    };

    DateLibrary.getEdgeDate = function (date, sign) {

        if (sign == 1) {
            return DateLibrary.createUTC(date.getUTCFullYear(), date.getUTCMonth() + 2, 1);
            //return DateLibrary.createUTC(date.getUTCFullYear(), date.getUTCMonth() + 2, 0, 23, 59, 59, 999);
        } else {
            return DateLibrary.createUTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
        }
    };

    DateLibrary.getDistanceToEdge = function (date, edgeDate) {

        // calculate the distance to the edge (01 or end) of the month
        edgeDate = typeof(edgeDate) == 'number' ? DateLibrary.getEdgeDate(date, edgeDate) : edgeDate;
        return DateLibrary.distanceUTC(date, edgeDate, 'd', true);
    };

    DateLibrary.numberOfDays = function (year, month) {

        if (typeof(month) == 'undefined' || month == null) {
            var d1 = Date.UTC(year + 1, 0, 0);
            var d2 = Date.UTC(year, 0, 0);

            return Math.floor((d1 - d2) / (1000 * 60 * 60 * 24));
        } else {

            /*
             * Getting the 0-day of the next month (month is zero based),
             * is the last day of the requested month.
             */
            return new Date(Date.UTC(year, month, 0)).getUTCDate();
        }
    };

    DateLibrary.formatUTC = function (date, format) {
        var p = DateLibrary.pad;

        var res = format;

        res = res.replace('yyyy', p(date.getUTCFullYear(), 4));
        res = res.replace('MM', p(date.getUTCMonth() + 1));
        res = res.replace('dd', p(date.getUTCDate()));
        res = res.replace('HH', p(date.getUTCHours()));
        res = res.replace('mm', p(date.getUTCMinutes()));
        res = res.replace('ss', p(date.getUTCSeconds()));

        return res;
    };

    DateLibrary.pad = function (nr, max) {
        var str = '' + nr;
        max = typeof(max) == 'undefined' || max == null ? 2 : max;

        return str.length < max ? DateLibrary.pad('0' + str, max) : str;
    };

    DateLibrary.normalizeLevel = function (level) {

        if (level == null || typeof(level) == 'undefined') {
            return null;
        }

        // first do some lower-case matching
        switch (level.toLowerCase()) {
            case 'y':
            case 'year':
            case 'years':
                return 'y';
            case 'm':
            case 'month':
            case 'months':
                return 'm';
            case 'd':
            case 'day':
            case 'days':
                return 'd';
            case 'h':
            case 'hour':
            case 'hours':
                return 'h';
            case 'mi':
            case 'minute':
            case 'minutes':
                return 'mi';
            case 's':
            case 'second':
            case 'seconds':
                return 's';
        }

        // add the formatting level as well
        switch (level) {
            case 'yyyy':
                return 'y';
            case 'MM':
                return 'm';
            case 'dd':
                return 'd';
            case 'HH':
                return 'h';
            case 'mm':
                return 'mi';
            case 'ss':
                return 's';
        }

        // fallback
        return null;
    };

    DateLibrary.getPreviousLevel = function (level) {
        level = DateLibrary.normalizeLevel(level);
        switch (level) {
            case 'y':
                return 'm';
            case 'm':
                return 'd';
            case 'd':
                return 'h';
            case 'h':
                return 'mi';
            case 'mi':
                return 's';
            case 's':
                return null;
        }
    };

    DateLibrary.getLevels = function () {
        return ['y', 'm', 'd', 'h', 'mi', 's'];
    };

    DateLibrary.distanceUTC = function (date1, date2, level, exact) {
        exact = typeof(exact) == 'undefined' || exact == null ? false : exact;
        level = DateLibrary.normalizeLevel(level);

        var fraction = 1;
        if (exact) {
            if (date1.getTime() == date2.getTime()) {
                return 0;
            }

            /*
             * The exact calculation is quiet complicated, it has to be following
             * the rules defined by DateLibrary.modifyUTC. It must apply that
             *
             *  dateB == DateLibrary.modifyUTC(dateA, DateLibrary.distanceUTC(dateA, dateB, l, true), l, true)
             */

            //noinspection FallThroughInSwitchStatementJS
            switch (level) {
                case 'y':
                    return DateLibrary.distanceUTC(date1, date2, 'm', true) / 12;
                    break;
                case 'm':
                    var ord = date1.getTime() < date2.getTime() ? 1 : -1;

                    // get the distance of each month within itself
                    var dist1Edge = DateLibrary.getEdgeDate(date1, ord);
                    var dist2Edge = DateLibrary.getEdgeDate(date2, -1 * ord);
                    var dist1 = DateLibrary.getDistanceToEdge(date1, dist1Edge) / DateLibrary.numberOfDays(date1.getUTCFullYear(), date1.getUTCMonth() + 1);
                    var dist2 = DateLibrary.getDistanceToEdge(date2, dist2Edge) / DateLibrary.numberOfDays(date2.getUTCFullYear(), date2.getUTCMonth() + 1);

                    // get the base, i.e. the full month between
                    var base = DateLibrary.distanceUTC(dist1Edge, dist2Edge, 'm', false);
                    return dist1 + -1 * dist2 + base;
                    break;
                case 'd':
                    fraction *= 24;
                case 'h':
                    fraction *= 60;
                case 'mi':
                    fraction *= 60;
                case 's':
                    fraction *= 1000;
                    break;
            }

            return (date2.getTime() - date1.getTime()) / fraction;
        } else {
            var prevLevel = DateLibrary.getPreviousLevel(level);

            var truncDate1 = prevLevel == null ? date1 : DateLibrary.truncateUTC(date1, prevLevel);
            var truncDate2 = prevLevel == null ? date2 : DateLibrary.truncateUTC(date2, prevLevel);

            // if the truncation modified the end, we increase it by 1
            if (level != 's' && date2.getTime() != truncDate2.getTime()) {
                truncDate2 = DateLibrary.modifyUTC(truncDate2, 1, level);
            }

            var diff = 0;

            //noinspection FallThroughInSwitchStatementJS
            switch (level) {
                case 'd':
                    fraction *= 24;
                case 'h':
                    fraction *= 60;
                case 'mi':
                    fraction *= 60;
                case 's':
                    diff = Math.ceil((truncDate2.getTime() - truncDate1.getTime()) / 1000);
                    diff /= fraction;
                    // nothing to do
                    break;
                case 'y':
                    diff = truncDate2.getFullYear() - truncDate1.getFullYear();
                    break;
                case 'm':
                    diff = (truncDate2.getFullYear() - truncDate1.getFullYear()) * 12;
                    diff -= truncDate1.getMonth() + 1;
                    diff += truncDate2.getMonth() + 1;
                    break;
            }

            return Math.ceil(diff);
        }
    };

    DateLibrary.parseString = function (value, format) {

        // check null
        if (value == null || typeof(value) == 'undefined') {
            return null;
        }

        // check if we have a Date
        if (value instanceof Date) {
            return value;
        }

        // change the defined format to a regular expression
        var regEx = format;

        // quote special characters
        regEx = regEx.replace(/(\.|\\|\+|\*|\?|\[|\^|\]|\$|\(|\)|\{|\}|\=|\!|\<|\>|\||\:|\-)/g, function (v) {
            return '\\' + v;
        });

        // replace the different markers
        regEx = regEx.replace('yyyy', '(\\d{4})');
        regEx = regEx.replace('MM', '(\\d{2})');
        regEx = regEx.replace('dd', '(\\d{2})');
        regEx = regEx.replace('HH', '(\\d{2})');
        regEx = regEx.replace('mm', '(\\d{2})');
        regEx = regEx.replace('ss', '(\\d{2})');

        var regex = new RegExp('^' + regEx + '$');
        var matches = regex.exec(value);
        if (matches != null) {

            // define the different group numbers
            var yyyy, MM, dd, HH, mm, ss;
            yyyy = MM = dd = HH = mm = ss = -1;

            var groupNr = 1;
            for (var i = 0, len = format.length; i < len;) {
                var token = format.substr(i, 2);
                if (token == 'MM') {
                    MM = groupNr;
                    i += 2;
                } else if (token == 'dd') {
                    dd = groupNr;
                    i += 2;
                } else if (token == 'HH') {
                    HH = groupNr;
                    i += 2;
                } else if (token == 'mm') {
                    mm = groupNr;
                    i += 2;
                } else if (token == 'ss') {
                    ss = groupNr;
                    i += 2;
                } else if (token == 'yy' && format.substr(i, 4) == 'yyyy') {
                    yyyy = groupNr;
                    i += 4;
                } else {
                    i++;
                    continue;
                }

                groupNr++;
            }

            var year = yyyy > -1 ? parseInt(matches[yyyy], 10) : 0;
            var month = MM > -1 ? parseInt(matches[MM], 10) : 1;
            var day = dd > -1 ? parseInt(matches[dd], 10) : 1;
            var hour = HH > -1 ? parseInt(matches[HH], 10) : 0;
            var minute = mm > -1 ? parseInt(matches[mm], 10) : 0;
            var second = ss > -1 ? parseInt(matches[ss], 10) : 0;

            return DateLibrary.createUTC(year, month, day, hour, minute, second);
        }

        // fallback
        return null;
    };

    DateLibrary.parseISO8601 = function (value) {

        // check null
        if (value == null || typeof(value) == 'undefined') {
            return null;
        }

        // check if we have a Date
        if (value instanceof Date) {
            return value;
        }

        // check ISO8601
        var regex = new RegExp('^([\\d]{4})\\-([\\d]{2})\\-([\\d]{2})T([\\d]{2}):([\\d]{2}):([\\d]{2})(\\.([\\d]{3}))?Z$');
        var matches = regex.exec(value);
        if (matches != null) {

            return DateLibrary.createUTC(
                parseInt(matches[1], 10),
                parseInt(matches[2], 10),
                parseInt(matches[3], 10),
                parseInt(matches[4], 10),
                parseInt(matches[5], 10),
                parseInt(matches[6], 10)
            );
        }

        // fallback
        return null;
    };

    return DateLibrary;
});
define('net/meisen/general/interval/Interval',['net/meisen/general/date/DateLibrary'], function (datelib) {
  
  var determineType = function(val) {
    switch (typeof(val)) {
      case 'number':
        return 'number';
        break;
      case 'object':
        if (val instanceof Date) {
          return 'date';
        } else {
          return null;
        }
        break;
      default:
        return null;
    }
  };
  
  var compare = function(type, val1, val2) {
    
    // null is handled as MAX_VALUE
    if (val1 == Interval.MAX_VALUE && val2 == Interval.MAX_VALUE) {
      return 0;
    } else if (val1 == Interval.MAX_VALUE) {
      return 1;
    } else if (val2 == Interval.MAX_VALUE) {
      return -1;
    }
    
    // handle a type if we have one
    if (type == 'number') {
      return val1 < val2 ? -1 : (val1 > val2 ? 1 : 0);
    } else if (type == 'date') {
      var dist = datelib.distanceUTC(val1, val2, 's');
      return dist > 0 ? -1 : (dist < 0 ? 1 : 0);
    }
  };
  
  /**
   * Constructor specifying the start and end as well 
   * as additional meta-information.
   */
  var Interval = function(start, end, data) {

    // get the type
    if (start == Interval.MAX_VALUE) {
      this.type = determineType(end);
    } else if (end == Interval.MAX_VALUE) {
      this.type = determineType(start);
    } else if (!((this.type = determineType(start)) == determineType(end))) {
      throw new Error('Invalid type "' + this.type + '" (' + start + ', ' + end + ').');
    }
    
    // make sure we have a type
    if (this.type == null) {
      throw new Error('Type cannot be determined, both values are Interval.MAX_VALUE ("' + start + ', "' + end + '").');
    }
    
    this.start = start;
    this.end = end;
    this.data = typeof(data) == 'undefined' ? null : data;
  };
  
  /**
   * Static value representing the MAX_VALUE, independent of the type.
   */
  Interval.MAX_VALUE = {};
  
  /**
   * Extended prototype
   */
  Interval.prototype = {
    
    get: function(value) {
      if (this.data == null) {
        return null;
      } else {
        return this.data[value];
      }
    },
    
    /**
     * Method used to set a meta-information for the this.
     */
    set: function(attribute, value) {
      if (this.data == null) {
        this.data = {};
      }
      this.data[attribute] = value;
    },
    
    /**
     * Compares this interval with the specified interval and
     * returns an int which tells if this is 
     * - less than (i.e. this < interval => -1), 
     * - equal (i.e. this == interval => 0), or 
     * - greater (i.e. this > interval => 1) than.
     */
    compare: function(interval) {
      var startCmp = compare(this.type, this.start, interval.start);

      if (startCmp == 0) {
        return compare(this.type, this.end, interval.end);
      } else {
        return startCmp;
      }
    },
    
    /**
     * Compares this interval with the specified interval and
     * returns an int which tells if this is 
     * - less than (i.e. this < interval => -1), 
     * - equal (i.e. this == interval => 0), or 
     * - greater (i.e. this > interval => 1) than.
     *
     * Compare reverse checks for the end first of equality and 
     * than of the start.
     */
    compareReverse: function(interval) {
      var endCmp = -1 * compare(this.type, this.end, interval.end);

      if (endCmp == 0) {
        return compare(this.type, this.start, interval.start);
      } else {
        return endCmp;
      }
    },
    
    /**
     * Compares the start value of this with the specified value.
     */
    compareStart: function(value) {
      return compare(this.type, this.start, value);
    },
    
    /**
     * Compares the end value of this with the specified value.
     */
    compareEnd: function(value) {
      return compare(this.type, this.end, value);
    },
    
    toString: function() {
      return '[' + this.start + ',' + this.end + ']';
    }
  };
  
  return Interval;
});
define('net/meisen/general/interval/IntervalCollection',['net/meisen/general/interval/Interval'], function (Interval) {

  /**
   * Default constructor...
   */
  var IntervalCollection = function() {
    this.sortedStartList = [];
    this.sortedEndList = [];
  };

  IntervalCollection.Interval = Interval;
  
  /**
   * Extended prototype:
   *
   * The implementation is not based on any typical IntervalTree
   * definition, instead a SortedList (maybe close to an AugmentedTree)
   * is used. Nevertheless, we just use a sorted array, which contains
   * the intervals in a sorted manner (see compare method).
   */
  IntervalCollection.prototype = {
    
    /**
     * Adds all the elements of the specified array.
     */
    insertAll: function(intervals) {
      
      // add all the values
      this.sortedStartList = this.sortedStartList.concat(intervals);
      this.sortedEndList = this.sortedEndList.concat(intervals);

      // sort the list afterwards
      this.sortedStartList.sort(this.compare);
      this.sortedEndList.sort(this.compareReverse);
    },
        
    insert: function(interval) {   
      var posStart = this.findPosition(this.sortedStartList, interval, null, null, this.compare);
      var posEnd = this.findPosition(this.sortedEndList, interval, null, null, this.compareReverse);
      
      // add the element to the list
      this.sortedStartList.splice(posStart, 0, interval);
      this.sortedEndList.splice(posEnd, 0, interval);
    },
    
    overlap: function(start, end) {
      
      // check if we have an interval
      if (start instanceof Interval) {
        end = start.end;
        start = start.start;
      }
      
      var posStart = this.findPosition(this.sortedStartList, new Interval(end, Interval.MAX_VALUE), null, null, this.compare);
      var posEnd = this.findPosition(this.sortedEndList, new Interval(Interval.MAX_VALUE, start), null, null, this.compareReverse);

      // make sure if everything is selected to do a fast path
      if (posStart == posEnd && posStart == this.sortedStartList.length) {
        return this.sortedStartList;
      }
      
      // get the shorter list of both
      var list;
      var cmpFunc;
      if (posStart < posEnd) {
        
        // we select start, i.e. all sel.start <= end
        list = this.sortedStartList.slice(0, posStart);
        cmpFunc = function(entry) {
          
          // compare the end value to make sure its >= start
          return entry.compareEnd(start) != -1;
        }
      } else {
        
        // we select end, i.e. all sel.end >= start
        list = this.sortedEndList.slice(0, posEnd);
        cmpFunc = function(entry) {
          
          // compare the start value to make sure its <= end
          return entry.compareStart(end) != 1;
        }
      }
      
      // filter the results
      var res = [];
      while(list.length > 0) {
        var entry = list.shift();
        if (cmpFunc(entry)) {       
          res.push(entry);
        }
      }
      return res;
    },
    
    size: function() {
      return this.sortedStartList.length;
    },
    
    clear: function() {
      this.sortedStartList = [];
      this.sortedEndList = [];
    },
    
    /**
     * Finds the position the interval has to be added to 
     * within the sortedList.
     */
    findPosition: function(arr, interval, start, end, cmpFunc) {
      cmpFunc = cmpFunc == null || typeof(cmpFunc) !== 'function' ? this.compare : cmpFunc;
      
      var len = arr.length;
      
      // just quit if there is no element, the position is always 0
      if (len == 0) {
        return 0;
      }
      
      start = typeof(start) == 'undefined' || start == null ? 0 : start;
      end = typeof(end) == 'undefined' || end == null ? len : end;

      var pivotPos = Math.floor(start + (end - start) / 2);
      var pivotElement = arr[pivotPos];
      
      var cmp = cmpFunc(pivotElement, interval);
      if (cmp == 0) {
        return pivotPos + 1;
      } else if (end - start <= 1) {
        return cmp == 1 ? pivotPos : pivotPos + 1;
      } else if (cmp == -1) {
        return this.findPosition(arr, interval, pivotPos, end, cmpFunc);
      } else {
        return this.findPosition(arr, interval, start, pivotPos, cmpFunc);
      }
    },
    
    /**
     * Compares two intervals returns an int which tells if the values compare 
     * - less than (i.e. interval1 < interval2 => -1), 
     * - equal (i.e. interval1 == interval2 => 0), or 
     * - greater (i.e. interval1 > interval2 => 1) than.
     */
    compare: function(interval1, interval2) {
      return interval1.compare(interval2);
    },
    
    /**
     * Compares two intervals returns an int which tells if the values compare 
     * - less than (i.e. interval1 < interval2 => -1), 
     * - equal (i.e. interval1 == interval2 => 0), or 
     * - greater (i.e. interval1 > interval2 => 1) than.
     *
     * Compare reverse checks for the end first of equality and than of the start.
     */
    compareReverse: function(interval1, interval2) {
      return interval1.compareReverse(interval2);
    }
  };
  
  return IntervalCollection;
});
define('net/meisen/general/Utility',[], function () {
  
  var TAGNAMES = {
    'select':'input',
    'change':'input',
    'submit':'form',
    'reset':'form',
    'error':'img',
    'load':'img',
    'abort':'img'
  };
  
  var Utility = function() {
  };
  
  Utility.isEventSupported = function(eventName) {
    var el = document.createElement(TAGNAMES[eventName] || 'div');
    
    eventName = 'on' + eventName;
    var isSupported = (eventName in el);
    if (!isSupported) {
      el.setAttribute(eventName, 'return;');
      isSupported = typeof el[eventName] == 'function';
    }
    el = null;
    
    return isSupported;
  };
  
  Utility.getSupportedEvent = function(events) {

    // get the length
    var len = events.length;
    if (typeof(len) == 'undefined') {
      len = 0;
    }
    
    for (var i = 0; i < len; i++) {
      if (Utility.isEventSupported(events[i])) {
        return events[i];
      }
    }
    
    return null;
  };
  
  return Utility;
});
define('net/meisen/ui/gantt/svg/Scrollbar',['jquery', 'net/meisen/general/Utility'], function ($, Utility) {

    var utilities = {
        createArrow: function (size, direction, click, theme) {
            var arrow = $(document.createElementNS('http://www.w3.org/2000/svg', 'g'));
            arrow.attr('class', 'gantt-scrollbar-arrow');

            el = $(document.createElementNS('http://www.w3.org/2000/svg', 'rect'));
            el.attr({'width': size, 'height': size, 'x': 0, y: 0, 'rx': 0, 'ry': 0});
            el.css({'fill': theme.buttonColor, 'stroke': theme.buttonColorBorder, 'stroke-width': 1});
            el.appendTo(arrow);

            el = $(document.createElementNS('http://www.w3.org/2000/svg', 'path'));
            if (direction == 'left') {
                el.attr({'d': 'M 8 4 L 8 10 5 7'});
            } else if (direction == 'right') {
                el.attr({'d': 'M 6 4 L 6 10 9 7'});
            } else if (direction == 'top') {
                el.attr({'d': 'M 4 8 L 10 8 7 5'});
            } else if (direction == 'bottom') {
                el.attr({'d': 'M 4 6 L 10 6 7 9'});
            }
            el.css({'fill': theme.arrowColor});
            el.appendTo(arrow);

            arrow.click(function () {
                if ($.isFunction(click)) {
                    click({direction: direction});
                }
            });

            return arrow
        },

        createScroll: function (scrollbar) {
            var _ref = this;

            return function (event) {

                var status = {
                    anchor: scrollbar.type == 'horizontal' ? event.pageX : event.pageY,
                    scrollbar: scrollbar
                };

                var moveHandler = function (event) {
                    var isHorizontal = scrollbar.type == 'horizontal';
                    var pos = isHorizontal ? event.pageX : event.pageY;
                    var diff = pos - status.anchor;

                    if (diff == 0) {
                        return;
                    } else {
                        var direction = diff < 0 ? (isHorizontal ? 'left' : 'top') : (isHorizontal ? 'right' : 'bottom');
                        diff = status.scrollbar.pixelToCoord(Math.abs(diff));
                        status.scrollbar.move(direction, diff);
                    }
                    status.anchor = pos;
                };
                var disableHandler = function (event) {
                    $(window).unbind('mousemove', moveHandler);
                    $(window).unbind('mouseup', disableHandler);
                };

                $(window).bind('mousemove', moveHandler);
                $(window).bind('mouseup', disableHandler);
            };
        }
    };

    /*
     * Default constructor...
     */
    Scrollbar = function (type) {
        this.type = typeof(type) == 'undefined' || type == null ? 'horizontal' : type;
    };

    /*
     * Extended prototype
     */
    Scrollbar.prototype = {
        bar: null,
        scrollarea: null,
        marker: null,
        leftArrow: null,
        rightArrow: null,

        size: {height: 0, width: 0},

        extent: 0,
        view: {
            position: 0,
            size: 0,
            total: 0
        },

        defaultCfg: {
            theme: {
                arrowSize: 14,
                scrollareaColor: '#EEEEEE',
                markerColor: '#BFC8D1',
                buttonColorBorder: '#666666',
                arrowColor: '#666666',
                buttonColor: '#EBE7E8'
            },
            hideOnNoScroll: true,
            propagateScrollOnNoMove: false,
            step: null
        },

        init: function (canvas, cfg) {
            var _ref = this;

            this.opts = $.extend(true, {}, this.defaultCfg, cfg);

            // create a group for the scrollbar
            this.bar = $(document.createElementNS('http://www.w3.org/2000/svg', 'g'));
            this.bar.attr('class', 'gantt-scrollbar-container');

            // create the scrollbar
            var extentAttribute = this.type == 'horizontal' ? 'height' : 'width';
            this.scrollarea = $(document.createElementNS('http://www.w3.org/2000/svg', 'rect'));
            this.scrollarea.attr({y: 0, 'rx': 0, 'ry': 0});
            this.scrollarea.attr(extentAttribute, this.getFixedExtent());
            this.scrollarea.css({
                'fill': this.opts.theme.scrollareaColor,
                'stroke': this.opts.theme.scrollareaColor,
                'stroke-width': 1
            });
            this.scrollarea.appendTo(this.bar);
            this.scrollarea.click(function (event) {
                var offset = _ref.bar.offset();

                var pos = _ref.type == 'horizontal' ? event.pageX - offset.left : event.pageY - offset.top;
                var coord = _ref.pixelToCoord(pos - (_ref.getFixedExtent() + 1));

                var direction;
                if (this.type == 'horizontal') {
                    direction = coord < _ref.view.position ? 'left' : 'right';
                } else {
                    direction = coord < _ref.view.position ? 'top' : 'bottom';
                }

                _ref.move(direction);
            });

            // create the scroll-marker
            this.marker = $(document.createElementNS('http://www.w3.org/2000/svg', 'rect'));
            this.marker.attr({'y': 0, 'rx': 0, 'ry': 0});
            this.marker.attr(extentAttribute, this.getFixedExtent());
            this.marker.css({
                'fill': this.opts.theme.markerColor,
                'stroke': this.opts.theme.markerColor,
                'stroke-width': 1,
                'cursor': 'default'
            });
            this.marker.appendTo(this.bar);
            this.marker.mousedown(utilities.createScroll(this));

            // create the left arrow
            this.leftArrow = utilities.createArrow(this.getFixedExtent(), this.type == 'horizontal' ? 'left' : 'top', function () {
                _ref.move('left', _ref.opts.step);
            }, this.opts.theme);
            this.leftArrow.appendTo(this.bar);

            // create the right arrow
            this.rightArrow = utilities.createArrow(this.getFixedExtent(), this.type == 'horizontal' ? 'right' : 'bottom', function () {
                _ref.move('right', _ref.opts.step);
            }, this.opts.theme);
            this.rightArrow.appendTo(this.bar);

            // append the scrollbar
            this.bar.appendTo(canvas);
        },

        setPosition: function (x, y) {

            /*
             * Nicer sharper look, see:
             * http://stackoverflow.com/questions/18019453/svg-rectangle-blurred-in-all-browsers
             */
            x = Math.floor(x) + 0.5;
            y = Math.floor(y) + 0.5;

            this.bar.attr({'transform': 'translate(' + x + ', ' + y + ')'});
        },

        move: function (direction, steps) {
            steps = typeof(steps) == 'undefined' ? this.view.size - 1 : steps;
            steps = steps == null ? Math.max(1.0, this.view.size / 10) : steps;

            var newPosition = this.view.position + ((direction == 'left' || direction == 'top' ? -1 : 1) * steps);
            newPosition = Math.max(0, newPosition);
            newPosition = Math.min(newPosition, this.view.total - this.view.size);

            this.setView(newPosition, null, null, false);
        },

        setView: function (position, size, total, force) {
            position = typeof(position) == 'undefined' || position == null ? this.view.position : position;
            size = typeof(size) == 'undefined' || size == null ? this.view.size : size;
            total = typeof(total) == 'undefined' || total == null ? this.view.total : total;
            force = typeof(force) == 'undefined' || force == null ? false : force;

            total = Math.max(0, total);
            position = Math.max(0, position);
            size = Math.max(0, size);

            // validate some values
            if (size > total) {
                size = total;
            }
            if (position + size > total) {
                position = total - size;
            }

            // check if we have a change or if it was forced to update
            var changed = this.view.position != position || this.view.size != size;
            if (!force && !changed && this.view.total == total) {
                return;
            } else {
                this.view = {position: position, size: size, total: total};
            }

            if (this.isVisible()) {
                this.bar.css('visibility', 'visible');
            } else {
                this.bar.css('visibility', 'hidden');
            }

            var offset = this.getFixedExtent() + 1;

            var scrollareaExtent = this.getScrollareaExtent();
            scrollareaExtent = isNaN(scrollareaExtent) ? 0 : scrollareaExtent;

            var markerExtent = this.coordToPixel(size);
            var markerPos = offset + this.coordToPixel(position);
            if (this.type == 'horizontal') {
                this.marker.attr({'width': markerExtent, 'x': markerPos});
            } else {
                this.marker.attr({'height': markerExtent, 'y': markerPos});
            }

            // trigger the event if there was a change
            if (changed) {
                this.bar.trigger('viewchange', {position: position, size: size, total: total});

                // trigger a size change if needed
                var _ref = this;
                setTimeout(function () {
                    var bbox = _ref.bar.get(0).getBBox();
                    var size = {'height': bbox.height, 'width': bbox.width};
                    if (_ref.size.height != size.height || _ref.size.width != size.width) {
                        _ref.size = size;
                        _ref.bar.trigger('sizechanged', _ref);
                    }
                }, 0);
            }
        },

        isVisible: function () {
            return !this.opts.hideOnNoScroll || this.isScrollable();
        },

        isScrollable: function () {
            return this.view.size != this.view.total;
        },

        pixelToCoord: function (pixel) {
            return pixel * (this.view.total / this.getScrollareaExtent());
        },

        coordToPixel: function (coord) {
            return this.view.total == 0 ? 0 : (coord / this.view.total) * this.getScrollareaExtent();
        },

        setExtent: function (extent, force) {
            extent = typeof(extent) == 'undefined' || extent == null ? this.extent : extent;
            force = typeof(force) == 'undefined' || force == null ? false : force;

            // check if we have a change or if it was forced to update
            if (!force && this.extent == extent) {
                return;
            } else {
                this.extent = extent;
            }

            // calculate the new values
            var offset = this.getFixedExtent() + 1;
            var scrollareaExtent = this.getScrollareaExtent();

            if (this.type == 'horizontal') {
                this.scrollarea.attr({'width': scrollareaExtent, 'x': offset});
                this.rightArrow.attr({'transform': 'translate(' + (offset + scrollareaExtent + 1) + ', 0)'});
            } else {
                this.scrollarea.attr({'height': scrollareaExtent, 'y': offset});
                this.rightArrow.attr({'transform': 'translate(0, ' + (offset + scrollareaExtent + 1) + ')'});
            }

            // force a redraw of the marker
            this.setView(null, null, null, true);
        },

        getFixedExtent: function () {
            return this.opts.theme.arrowSize;
        },

        getView: function () {
            return this.view;
        },

        getExtent: function () {
            return this.extent;
        },

        getScrollareaExtent: function () {
            var offset = this.getFixedExtent() + 1;
            return Math.max(0, this.extent - 2 * offset);
        },

        bindToWheel: function (selector) {
            var el = selector instanceof $ ? selector : $(el);

            var eventName = Utility.getSupportedEvent(['mousewheel', 'wheel']);
            if (eventName == null) {
                return;
            }

            var _ref = this;
            el.on(eventName, function (e) {
                var oEvent = e.originalEvent;

                /*
                 * Chrome and Internet Explorer support wheelDelta, whereby FireFox only
                 * returns the deltaY (which is pretty small and 40 seems to be a good value)
                 * to multiply with.
                 */
                var delta = (-1 * oEvent.wheelDelta) || 40 * oEvent.deltaY;

                var direction = delta > 0 ? 'bottom' : 'top';
                var oldPos = _ref.view.position;
                _ref.move(direction, Math.abs(delta / 120));

                // if there was no scroll propagate it
                return _ref.opts.propagateScrollOnNoMove && oldPos == _ref.view.position;
            });
        },

        on: function (event, handler) {
            this.bar.on(event, handler);
        },

        off: function (event, handler) {
            this.bar.off(event, handler);
        },

        getSize: function () {
            return this.size;
        }
    };

    return Scrollbar;
});
define('net/meisen/ui/gantt/svg/TimeAxis',['jquery', 'net/meisen/general/date/DateLibrary'], function ($, datelib) {

    var utilities = {
        drawTicks: function (ticks, gap, numberOfGaps, theme) {

            // remove all ticks
            ticks.empty();

            // create the ticks
            for (var i = 0; i <= numberOfGaps + 1; i++) {
                var x = i * gap;

                var g = $(document.createElementNS('http://www.w3.org/2000/svg', 'g'));
                g.attr('class', 'gantt-timeaxis-text');
                g.css({
                    '-webkit-touch-callout': 'none',
                    '-webkit-user-select': 'none',
                    '-khtml-user-select': 'none',
                    '-moz-user-select': 'none',
                    '-ms-user-select': 'none',
                    'user-select': 'none'
                });

                var tick = $(document.createElementNS('http://www.w3.org/2000/svg', 'line'));
                tick.attr({'x1': x, 'y1': 0, 'x2': x, 'y2': 10});
                tick.css({'stroke': theme.tickColor, 'stroke-width': theme.tickWidth});
                tick.appendTo(g);

                var label = $(document.createElementNS('http://www.w3.org/2000/svg', 'text'));
                label.attr({'x': x, 'y': theme.labelSize + 10});
                label.css({
                    'color': theme.labelColor,
                    'cursor': 'default',
                    'fontSize': theme.labelSize + 'px',
                    'fill': theme.labelColor
                });

                var text = $(document.createElementNS('http://www.w3.org/2000/svg', 'tspan'));
                text.attr({'x': x, 'text-anchor': 'middle'});
                text.appendTo(label);
                label.appendTo(g);

                g.appendTo(ticks);
            }
        }
    };

    /*
     * Default constructor...
     */
    TimeAxis = function () {
        this.width = 0;
        this.gap = 0;
        this.relativeMove = 0;
        this.size = {
            height: 0,
            width: 0
        };
        this.settings = {
            type: null,
            rawstart: null,
            rawend: null,
            last: null,
            level: null
        };
        this.view = {
            position: 0,
            size: 0,
            total: 0
        };
    };

    /*
     * Extended prototype
     */
    TimeAxis.prototype = {
        defaultCfg: {
            tickInterval: null,
            formatter: function (value, type, level) {
                if (type == 'number') {
                    return value;
                } else if (type == 'date') {

                    var format;
                    switch (level) {
                        case 'y':
                            format = 'yyyy';
                            break;
                        case 'm':
                            format = 'MM.yyyy';
                            break;
                        case 'd':
                            format = 'dd.MM.yyyy';
                            break;
                        case 'h':
                            format = 'dd.MM.yyyy HH';
                            break;
                        case 'mi':
                            format = 'dd.MM.yyyy HH:mm';
                            break;
                        case 's':
                            format = 'dd.MM.yyyy HH:mm:ss';
                            break;
                    }

                    return datelib.formatUTC(value, format);
                } else {
                    return value;
                }
            },
            theme: {
                tickColor: '#C0D0E0',
                tickWidth: 1,
                labelColor: '#606060',
                labelSize: 11
            }
        },

        init: function (canvas, cfg) {
            this.opts = $.extend(true, {}, this.defaultCfg, cfg);

            this.axis = $(document.createElementNS('http://www.w3.org/2000/svg', 'g'));
            this.axis.attr('class', 'gantt-timeaxis-container');

            // create a separating line
            this.sepLine = $(document.createElementNS('http://www.w3.org/2000/svg', 'line'));
            this.sepLine.attr({'x1': 0, 'y1': 0, 'y2': 0});
            this.sepLine.css({'stroke': '#C0D0E0', 'stroke-width': 1});
            this.sepLine.appendTo(this.axis);

            // create the group of the ticks
            this.ticks = $(document.createElementNS('http://www.w3.org/2000/svg', 'g'));
            this.ticks.attr('class', 'gantt-timeaxis-ticks');
            this.ticks.appendTo(this.axis);

            var _ref = this;
            this.ticks.on('labelchange', function () {
                setTimeout(function () {
                    _ref.recalibrateLabels();
                }, 0);
            });

            this.axis.appendTo(canvas);
        },

        setWidth: function (width, force) {
            width = typeof(width) == 'undefined' || width == null ? this.width : width;
            force = typeof(force) == 'undefined' || force == null ? false : force;

            // check if we have a change or if it was forced to update
            if (!force && this.width == width) {
                return;
            } else {
                this.width = width;
            }

            this.sepLine.attr({'x2': width});

            // force a redraw of the marker
            this.setAxis(null, null, null, true);
        },

        setView: function (position, size, total, force) {
            position = typeof(position) == 'undefined' || position == null ? this.view.position : position;
            size = typeof(size) == 'undefined' || size == null ? this.view.size : size;
            total = typeof(total) == 'undefined' || total == null ? this.view.total : total;
            force = typeof(force) == 'undefined' || force == null ? false : force;

            total = Math.max(0, total);
            position = Math.max(0, position);
            size = Math.max(0, size);

            // validate some values
            if (size > total) {
                size = total;
            }
            if (position + size > total) {
                position = total - size;
            }

            // check if we have a change or if it was forced to update
            var redrawTicks = force || this.view.size != size || this.view.total != total;
            var changed = redrawTicks || this.view.position != position;
            if (!force && !changed) {
                return;
            } else {
                this.view = {position: position, size: size, total: total};
            }

            // determine the tickInterval and the number of gaps
            var numberOfGaps;
            var tickInterval;
            if (typeof(this.opts.tickInterval) == 'undefined' || this.opts.tickInterval == null) {
                tickInterval = 1;
                while ((numberOfGaps = Math.max(1, Math.ceil((size) / tickInterval))) > 8) {
                    tickInterval++;
                }
            } else {
                tickInterval = this.opts.tickInterval;
                numberOfGaps = Math.max(1, Math.ceil((size) / tickInterval));
            }

            // determine the ratio of one pos value to the pixels
            var totalWidth = this.getTotalWidth();
            var ratio = total == 0 ? 0 : totalWidth / (total - 1);

            // use the ratio to calculate the size of the gap and the relativeMove
            this.gap = tickInterval * ratio;
            this.relativeMove = this.gap == 0 ? 0 : -1 * ((position * ratio) % this.gap);

            // move the axis based on the current position
            this.ticks.attr({'transform': 'translate(' + this.relativeMove + ', 0)'});

            // redraw the ticks if needed
            if (redrawTicks) {
                utilities.drawTicks(this.ticks, this.gap, numberOfGaps, this.opts.theme);
            }

            // add the number of the labels
            var start = Math.round(position / tickInterval) * tickInterval;
            var i = 0;
            var _ref = this;
            this.ticks.find('g').each(function (idx, el) {
                var tickGroup = $(el);

                // check if the first one is currently used
                if (idx == 0 && _ref.relativeMove <= -0.5 * _ref.gap) {
                    tickGroup.removeAttr('data-index');
                } else {
                    var pos = start + i * tickInterval;
                    if (pos < 0 || pos > _ref.settings.last) {
                        tickGroup.removeAttr('data-index');
                    } else {
                        tickGroup.attr('data-index', pos);
                    }
                    i++;
                }
            });

            // trigger the event if there was a change
            if (changed) {
                var data = _ref.getViewPositions();
                data.rawstart = this.getRawValue(data.start);
                data.rawend = this.getRawValue(data.end);

                data.axis = this;

                // get the rawValues
                this.axis.trigger('viewchange', data);
            }

            // make sure the labels are fixed
            this.ticks.trigger('labelchange');
        },

        getTotalWidth: function () {
            return this.view.size == 0 ? this.width : this.width * (this.view.total - 1) / (this.view.size - 1);
        },

        recalibrateLabels: function () {
            var _ref = this;

            this.ticks.children('g').each(function (idx, el) {
                var tickGroup = $(el);
                var text = tickGroup.children('text');

                // get the number
                var number = tickGroup.attr('data-index');
                number = typeof(number) == 'undefined' || number == null ? -1 : parseInt(number);

                var textNumber = tickGroup.attr('data-format');
                textNumber = typeof(textNumber) == 'undefined' || textNumber == null ? -1 : parseInt(textNumber);

                // do the formatting if needed
                if (number != -1 && number != textNumber) {
                    _ref.formatLabel(number, text);
                    tickGroup.attr('data-format', number);
                }

                // determine if the value is out of scope
                var viewPos = _ref.getViewPositions();
                if (number == -1 || viewPos.start > number || viewPos.end < number) {
                    tickGroup.css('visibility', 'hidden');
                } else {
                    tickGroup.css('visibility', 'visible');
                }
            });

            var bbox = this.axis.get(0).getBBox();
            var size = {'height': bbox.height, 'width': bbox.width};
            if (this.size.height != size.height || this.size.width != size.width) {
                this.size = size;
                this.axis.trigger('sizechanged', this);
            }
        },

        getViewPositions: function () {
            var sPos = this.view.position;
            var ePos = Math.max(0, sPos + this.view.size - 1);

            return {start: sPos, end: ePos};
        },

        formatLabel: function (number, label) {
            var formattedText = this.opts.formatter(this.getRawValue(number), this.settings.type, this.settings.level);
            var tspans = label.children('tspan');
            tspans.text(formattedText);

            // determine if the element has to be shown
            bbox = label.get(0).getBBox();

            // let's try to split the text if no space is available
            if (bbox.width > this.gap) {

                // split the text in the middle
                var middle = Math.floor(formattedText.length * 0.5);
                var pos = -1;
                for (var i = 0; i < middle; i++) {
                    if (formattedText[middle - i] == ' ') {
                        pos = middle - i;
                        break;
                    } else if (formattedText[middle + i] == ' ') {
                        pos = middle + i;
                        break;
                    }
                }

                if (pos != -1) {
                    var tspanMain = tspans.eq(0);
                    var tspanSub = tspans.eq(1);
                    tspanSub = tspanSub.length == 0 ? $(document.createElementNS('http://www.w3.org/2000/svg', 'tspan')).appendTo(label) : tspanSub;

                    // set the new text
                    tspanMain.text(formattedText.substring(0, pos));
                    tspanSub.text(formattedText.substring(pos + 1));
                    tspanSub.attr({
                        'text-anchor': 'middle',
                        'x': tspanMain.attr('x'),
                        'dy': 1.2 * this.opts.theme.labelSize
                    });
                }
            } else if (tspans.length > 1) {
                tspans.slice(1).remove();
            }
        },

        getLastViewPosition: function () {
            return this.settings.last;
        },

        getAmountOfEntries: function () {
            return this.settings.last + 1;
        },

        setPosition: function (x, y) {

            /*
             * Nicer sharper look, see:
             * http://stackoverflow.com/questions/18019453/svg-rectangle-blurred-in-all-browsers
             */
            x = Math.floor(x) + 0.5;
            y = Math.floor(y) + 0.5;
            this.axis.attr({'transform': 'translate(' + x + ', ' + y + ')'});
        },

        getRawValue: function (pos) {
            pos = typeof(pos) == 'undefined' || pos == null ? 0 : pos;

            if (this.settings.type == 'number') {
                return pos + this.settings.rawstart;
            } else if (this.settings.type == 'date') {
                return datelib.modifyUTC(this.settings.rawstart, pos, this.settings.level, true);
            } else {
                return pos;
            }
        },

        getPos: function (rawValue) {
            var pos;
            if (this.settings.type == 'number') {
                pos = rawValue - this.settings.rawstart;
            } else if (this.settings.type == 'date') {
                pos = datelib.distanceUTC(this.settings.rawstart, rawValue, this.settings.level, true);
            } else {
                return null;
            }

            return pos;
        },

        getPixelPos: function (rawValue) {
            var pos = this.getPos(rawValue);
            return this.getPixelPosOfPos(pos);
        },

        getPixelPosOfPos: function (pos) {
            var totalWidth = this.getTotalWidth();
            var ratio = this.view.total == 0 ? 0 : totalWidth / (this.view.total - 1);

            return pos * ratio + this.relativeMove;
        },

        getRelativePixelPosOfPos: function (pos) {
            var pxAxisStartPos = this.getPixelPosOfPos(this.view.position);
            var pxPos = this.getPixelPosOfPos(pos);

            return pxPos - pxAxisStartPos;
        },

        getRelativePixelPos: function (rawValue) {
            var pos = this.getPos(rawValue);
            return this.getRelativePixelPosOfPos(pos);
        },

        setAxis: function (start, end, level, force) {
            var recalc = false;

            // check the start
            var rawstart;
            if (typeof(start) == 'undefined' || start == null) {
                rawstart = this.settings.rawstart;
            } else {
                rawstart = start;
                recalc = true;
            }

            // check the end
            var rawend;
            if (typeof(end) == 'undefined' || end == null) {
                rawend = this.settings.rawend;
            } else {
                rawend = end;
                recalc = true;
            }

            // check level and force
            level = typeof(level) == 'undefined' || level == null ? this.settings.level : datelib.normalizeLevel(level);
            force = typeof(force) == 'undefined' || force == null ? false : force;

            // determine the type
            var type;
            if (rawstart instanceof Date && rawend instanceof Date) {
                type = 'date';
            } else if ($.isNumeric(rawstart) && $.isNumeric(rawend)) {
                type = 'number';
            } else {
                type = null;
            }

            // finally get the last
            var last;
            if (recalc) {
                if (type == 'date') {
                    last = datelib.distanceUTC(rawstart, rawend, level);
                } else if (type == 'number') {
                    last = rawend - rawstart;
                } else {
                    last = null;
                }
            } else {
                last = this.settings.last;
            }

            // check if we have a change or if it was forced to update
            var changed = recalc || this.settings.type != type || this.settings.last != last || this.settings.level != level;
            if (!force && !changed) {
                return;
            } else {
                this.settings = {type: type, rawstart: rawstart, rawend: rawend, last: last, level: level};
            }

            // trigger the event if there was a change
            this.setView(null, null, null, true);
        },

        on: function (event, handler) {
            this.axis.on(event, handler);
        },

        off: function (event, handler) {
            this.axis.off(event, handler);
        },

        getSize: function () {
            return this.size;
        }
    };

    return TimeAxis;
});
define('net/meisen/ui/svglibrary/SvgLibrary',['jquery'], function ($) {

    var Util = {
        cache: {},

        setImage: function (image, el) {
            el.css('backgroundImage', 'url("data:image/svg+xml;base64,' + image + '")');
        },

        setImageFromCache: function (image, el) {
            var encImage = this.cache[image];

            if (typeof(encImage) == 'undefined' || encImage == null) {
                throw new Error('Invalid cached image "' + image + '" selected.');
            } else {
                this.setImage(encImage, el);
            }
        },

        el: function (selector) {
            if (selector instanceof $) {
                return selector;
            } else if (typeof selector === 'string') {
                return $(selector);
            } else if (selector instanceof Element) {
                return $(selector);
            } else {
                console.log('Unexpected selector: ', selector);
                return $(selector);
            }
        }
    };

    return {
        svgUrlAttr: 'data-svgimage-url',
        svgNameAttr: 'data-svgimage',

        randomColor: function () {
            var letters = '0123456789ABCDEF'.split('');
            var color = '#';
            for (var i = 0; i < 6; i++) {
                color += letters[Math.floor(Math.random() * 16)];
            }

            return color;
        },

        complementaryColor: function (color) {
            if (color[0] == '#') {
                color = color.substr(1);
            }

            var rtn = "#";
            var value;
            value = 255 - parseInt(color.substr(0, 2), 16);
            value = ((value < 10) ? '0' : '') + value.toString(16);
            value = (value.length === 1) ? '0' + value : value;
            rtn += value;

            value = 255 - parseInt(color.substr(2, 2), 16);
            value = ((value < 10) ? '0' : '') + value.toString(16);
            value = (value.length === 1) ? '0' + value : value;
            rtn += value;

            value = 255 - parseInt(color.substr(4, 2), 16);
            value = ((value < 10) ? '0' : '') + value.toString(16);
            value = (value.length === 1) ? '0' + value : value;
            rtn += value;

            return rtn;
        },

        applyRandomColors: function (selector, style) {
            var els = Util.el(selector);

            var _ref = this;
            els.each(function () {
                var color = _ref.randomColor();
                $(this).css(style, color);
            });
        },

        applyRandomForegroundColors: function (selector) {
            this.applyRandomColors(selector, 'backgroundColor');
        },

        applyRandomBackgroundColors: function (selector) {
            this.applyRandomColors(selector, 'color');
        },

        applyRandomColorPairs: function (selector) {
            var els = Util.el(selector);

            var _ref = this;
            els.each(function () {
                var el = $(this);
                var color1 = _ref.randomColor();
                var color2 = _ref.complementaryColor(color1);

                el.css('backgroundColor', color1);
                el.css('color', color2);
            });
        },

        setBackgroundImageByAttribute: function (selector) {
            var _ref = this;

            var els = Util.el(selector);
            var urlImages = els.filter('[' + this.svgUrlAttr + ']');
            urlImages.each(function () {
                var el = $(this);
                var image = el.attr(_ref.svgUrlAttr);

                _ref.loadImageFromUrl(image, image, function () {
                    _ref.setBackgroundImageByName(el, image);
                });
            });

            var namedImages = els.filter('[' + this.svgNameAttr + ']');
            namedImages.each(function () {
                var el = $(this);
                var name = el.attr(_ref.svgNameAttr);

                _ref.setBackgroundImageByName(el, name);
            });
        },

        loadImageFromUrl: function (name, url, callback) {
            var _ref = this;

            $.get(url, function (data) {
                _ref.addImageToCache(name, data);

                if (typeof callback === 'function') {
                    callback(name);
                }
            }, 'text');
        },

        addImageToCache: function (name, image) {
            Util.cache[name] = window.btoa(image);
        },

        setBackgroundImageByName: function (selector, name) {
            var els = Util.el(selector);

            if (typeof(Util.cache[name]) === 'undefined') {
                throw new Error('The image "' + name + '" could not be found.');
            } else {
                Util.setImageFromCache(name, els);
            }
        },

        setBackgroundImage: function (selector, image) {
            var els = Util.el(selector);
            Util.setImage(window.btoa(image), els);
        },

        modifyTransform: function (selector, func, value) {
            var els = Util.el(selector);
            func = func.toLowerCase();

            var transform = els.attr('transform');
            if (typeof(transform) == 'undefined' || transform == null) {
                els.attr('transform', func + '(' + value + ')');
            } else {
                var calls = transform.split(/[ ,](?=[^\)]*(?:\(|$))/);
                var lenCalls = calls.length;

                var found = false;
                var counter = 0;
                var newTransform = '';
                for (var i = 0; i < lenCalls; i++) {
                    if (counter > 0) {
                        newTransform += ' ';
                    }

                    var call = calls[i].toLowerCase();
                    if (!found && call.indexOf(func + '(') == 0) {

                        // if the value is null the transform should be removed
                        if (value != null) {
                            newTransform += func + '(' + value + ')';
                            counter++;
                        }
                        found = true;
                    } else {
                        newTransform += call;
                        counter++;
                    }
                }

                // if not found just append it
                if (!found) {
                    newTransform += ' ' + func + '(' + value + ')';
                }

                els.attr('transform', newTransform);
            }
        }
    };
});
define('net/meisen/general/number/NumberLibrary',[], function () {

    /*
     * Default constructor...
     */
    var NumberLibrary = function () {
    };

    /**
     * The decimal point symbol used within the format.
     */
    NumberLibrary.decimalPoint = '.';
    NumberLibrary.groupSeparator = ',';
    NumberLibrary.forcedPlace = '0';
    NumberLibrary.optionalPlace = '#';

    /**
     *
     * @param {number} number the number to be formatted
     * @param {string} format the format to apply
     * @param {string} [decimalPoint=.] the decimal point, e.g., in the US "." and in Germany ","
     * @param {string} [groupSeparator=,] the group separator to be used, e.g., in the US "," and in Germany "."
     * @returns {*}
     */
    NumberLibrary.format = function (number, format, decimalPoint, groupSeparator) {
        if (typeof(format) == 'undefined' || format == null || typeof(number) == 'undefined' || number == null) {
            return null;
        }

        var formattedNumber = '';

        decimalPoint = typeof(decimalPoint) == 'undefined' || decimalPoint == null ? '.' : decimalPoint;
        groupSeparator = typeof(decimalPoint) == 'undefined' || groupSeparator == null ? ',' : groupSeparator;

        // determine some information of the format
        var formatStat = typeof(format) == 'string' ? NumberLibrary.createStat(format) : format;

        // round the number, and create the stat
        var roundedNumber = number.toFixed(formatStat.decimalPlaces);

        // removing leading & trailing zeros, and create the stats
        roundedNumber = roundedNumber[0] == '0' && roundedNumber.length > 1 ? roundedNumber.substring(1) : roundedNumber;
        roundedNumber = roundedNumber.indexOf('.') > -1 ? roundedNumber.replace(/0*$/, '') : roundedNumber;
        var numberStat = NumberLibrary.createStat(roundedNumber);

        // add the preDecimalPlaces
        var diffPreDecimalPlaces = formatStat.fixedPreDecimalPlaces - numberStat.preDecimalPlaces;
        if (diffPreDecimalPlaces > 0) {
            formattedNumber = new Array(diffPreDecimalPlaces + 1).join('0') + numberStat.preDecimal;
        } else if (numberStat.preDecimalPlaces > 0) {
            formattedNumber = numberStat.preDecimal;
        }

        // add the group separator
        if (formatStat.groupSeparatorPos.length > 0) {
            var isGroupSeparatorPos = function (pos) {
                var len = formatStat.groupSeparatorPos.length;
                for (var i = 0; i < len; i++) {
                    var groupPos = formatStat.groupSeparatorPos[i];

                    if (groupPos == pos) {
                        return true;
                    } else if (groupPos > pos) {
                        return false;
                    }
                }

                return false;
            };

            var groupedFormattedNumber = '';
            var len = formattedNumber.length;
            for (var i = 0; i < len; i++) {
                var value = formattedNumber[len - i - 1];
                if (isGroupSeparatorPos(i)) {
                    groupedFormattedNumber = groupSeparator + groupedFormattedNumber;
                }
                groupedFormattedNumber = value + groupedFormattedNumber
            }

            formattedNumber = groupedFormattedNumber;
        }

        // add the decimal point and decimalPlaces
        if (formatStat.fixedDecimalPlaces > 0 || numberStat.decimalPlaces > 0) {
            formattedNumber += decimalPoint;

            var diffDecimalPlaces = formatStat.fixedDecimalPlaces - numberStat.decimalPlaces;
            if (diffDecimalPlaces > 0) {
                formattedNumber += numberStat.decimal + new Array(diffDecimalPlaces + 1).join('0')
            } else if (numberStat.decimalPlaces > 0) {
                formattedNumber += numberStat.decimal;
            }
        }

        return formattedNumber;
    };

    NumberLibrary.createStat = function (o) {
        var fullLength = o.length;
        var decimalPointPos = o.indexOf(NumberLibrary.decimalPoint);
        var decimalPlaces = decimalPointPos == -1 ? 0 : fullLength - decimalPointPos - 1;
        var preDecimalPlaces = decimalPointPos == -1 ? fullLength : fullLength - decimalPlaces - 1;

        // correct the decimalPoint
        decimalPointPos = decimalPointPos == -1 ? fullLength : decimalPointPos;

        // get the different formats
        var decimal = o.substr(decimalPointPos + 1, decimalPlaces);
        var rawPreDecimal = o.substr(decimalPointPos - preDecimalPlaces, preDecimalPlaces);
        var preDecimal = rawPreDecimal.split(NumberLibrary.groupSeparator).join('');

        // get the grouping defined
        var len = rawPreDecimal.length;
        var groupSeparatorPos = [];
        if (len != preDecimal.length) {
            var reverseRawPreDecimal = rawPreDecimal.split('').reverse().join('');
            var amount = 0;
            for (var i = 0; i < len; i++) {
                if (reverseRawPreDecimal[i] == NumberLibrary.groupSeparator) {
                    groupSeparatorPos.push(i - amount);
                    amount++;
                }
            }
        }

        // count the 'leading' zeros
        var forcedCounter = function (o) {
            var len = o.length, counter = 0;
            for (var i = 0; i < len; i++) {
                if (o[i] == NumberLibrary.forcedPlace) {
                    counter++;
                } else {
                    break;
                }
            }

            return counter;
        };
        var fixedDecimalPlaces = forcedCounter(decimal);
        var fixedPreDecimalPlaces = forcedCounter(preDecimal.split('').reverse().join(''));

        return {
            decimal: decimal,
            preDecimal: preDecimal,
            decimalPlaces: decimalPlaces,
            preDecimalPlaces: preDecimalPlaces,
            fixedDecimalPlaces: fixedDecimalPlaces,
            fixedPreDecimalPlaces: fixedPreDecimalPlaces,
            groupSeparatorPos: groupSeparatorPos
        }
    };

    return NumberLibrary;
});
define('net/meisen/ui/gantt/svg/IntervalView',['jquery', 'net/meisen/ui/svglibrary/SvgLibrary', 'net/meisen/general/date/DateLibrary', 'net/meisen/general/number/NumberLibrary'], function ($, svgLibrary, dateLibrary, numberLibrary) {

  var util = {

    /**
     * Generate unique IDs for use as pseudo-private/protected names.
     *
     * Thanks to: https://gist.github.com/gordonbrander/2230317
     */
    randomId: function () {
      /*
       * Math.random should be unique because of its seeding algorithm.
       * Convert it to base 36 (numbers + letters), and grab the first 9 characters
       * after the decimal.
       */
      return '_' + Math.random().toString(36).substr(2, 9);
    },

    createShadow: function (id, opacity, width) {
      var shadow = $(document.createElementNS('http://www.w3.org/2000/svg', 'path'));
      shadow.attr({'id': id, 'transform': 'translate(1,1)'});
      shadow.css({'stroke-width': width, 'opacity': opacity, 'fill': 'none', 'stroke': '#000000'});

      return shadow;
    },

    getLineHeight: function (fontSize) {
      return 1.2 * fontSize;
    },

    replace: function (text, data) {
      var reg = new RegExp('\\{(\\d+)(?:\\|(date|number)(?:\\|([^\\}]+))?)?\\}', 'i');

      var result;
      var tmpText = null;
      while ((result = reg.exec(text)) !== null && tmpText != text) {
        tmpText = text;

        var replacement = util.format(data[result[1] - 1], result[2], result[3]);
        text = text.replace(result[0], replacement);
      }

      return text;
    },

    format: function (value, type, format) {

      // determine missing parameters
      type = typeof(type) == 'undefined' ? $.type(value) : type;
      format = typeof(format) == 'undefined' ? (type == 'number' ? '###,###,###,###,##0.####' : (type == 'date' ? 'dd.MM.yyyy HH:mm:ss' : null)) : format;

      // determine the resulting value
      if (type == 'date') {
        return dateLibrary.formatUTC(value, format);
      } else if (type == 'number') {
        return numberLibrary.format(value, format);
      } else if (type == 'string' || typeof(type) == 'undefined' || type == null) {
        return value;
      } else {
        return '\u00a0';
      }

    },

    createToolTipPath: function (canvasEl, el, mouse, text, theme) {
      curveRadius = typeof(theme) == 'undefined' ? 3 : theme.tooltipRadius;
      arrowSize = typeof(theme) == 'undefined' ? 6 : theme.tooltipArrow;
      margin = typeof(theme) == 'undefined' ? 0 : theme.tooltipMargin;

      // get the position of the element
      var canvasBbox = canvasEl.get(0).getBBox();
      var bbox = el.get(0).getBBox();

      // make sure we have a valid instance
      if (text instanceof $ == false) {
        return null;
      }

      /*
       * Calculate the size of the box. Typically this should be very easy,
       * just get the BBox of the box like done above:
       *   canvasEl.append(text);
       *   var textBbox = text.get(0).getBBox();
       *
       *   var textWidth = Math.max(1.5 * arrowSize, textBbox.width);
       *   var textHeight = Math.max(1.5 * arrowSize, textBbox.height);
       *
       *   text.remove();
       * Nevertheless, thanks to Internet Explorer (<= 11), and the missing
       * support of dominant-baseline as well as the miss-calculation of the 
       * text height, we have to do it differently.
       */

      // append the text to determine the size and remove it
      canvasEl.append(text);
      var textBbox = text.get(0).getBBox();
      text.remove();

      // determine the size of the text
      var textWidth = Math.max(1.5 * arrowSize, textBbox.width);
      var textHeight = Math.max(1.5 * arrowSize, text.children('tspan').length * util.getLineHeight(theme.tooltipSize));
      var offsetYText = -0.2 * util.getLineHeight(theme.tooltipSize);

      // calculate the full size of the tool-tip
      var totalMargin = 2 * margin;
      var toolTipWidth = textWidth + 2 * curveRadius;
      var toolTipHeight = textHeight + 2 * curveRadius;
      var arrowToolTipWidth = toolTipWidth + arrowSize;
      var arrowToolTipHeight = toolTipHeight + arrowSize;
      var totalToolTipWidth = arrowToolTipWidth + totalMargin;
      var totalToolTipHeight = arrowToolTipHeight + totalMargin;
      var arrowDist = arrowSize + curveRadius + margin;

      var canvasOffset = canvasEl.offset();
      var posArrowY = mouse.pageY - canvasOffset.top;
      var posArrowX = mouse.pageX - canvasOffset.left;

      var boundTopX = arrowDist;
      var boundTopY = arrowDist;
      var boundBottomX = canvasBbox.width - arrowDist - 5;
      var boundBottomY = canvasBbox.height - arrowDist - 5;

      // Check if there is room to the right
      var pos, posTopX, posTopY, posArrow;

      // Check if there is room to the top
      if (bbox.y > totalToolTipHeight && posArrowX > boundTopX && posArrowX < boundBottomX) {
        pos = 'top';
        posArrow = posArrowX;
        posTopX = posArrow - 0.5 * toolTipWidth;
        posTopY = bbox.y - arrowToolTipHeight - 3;

        // make sure it's not out of boundaries
        posTopX = Math.min(canvasBbox.width - toolTipWidth - margin, Math.max(margin, posTopX));
        posArrow = Math.max(boundTopX, Math.min(boundBottomX, posArrow));
      }
      // Check if there is room to the bottom
      else if (canvasBbox.height - (bbox.y + bbox.height) > totalToolTipHeight && posArrowX > boundTopX && posArrowX < boundBottomX) {
        pos = 'bottom';
        posArrow = posArrowX;
        posTopX = posArrow - 0.5 * toolTipWidth;
        posTopY = bbox.y + bbox.height + arrowSize + 3;

        // make sure it's not out of boundaries
        posTopX = Math.min(canvasBbox.width - toolTipWidth - margin, Math.max(margin, posTopX));
        posArrow = Math.max(boundTopX, Math.min(boundBottomX, posArrow));
      }
      // check if there is room to the right
      else if (canvasBbox.width - (bbox.x + bbox.width) > totalToolTipWidth && posArrowY > boundTopY && posArrowY < boundBottomY) {
        pos = 'right';
        posArrow = posArrowY;

        posTopX = bbox.x + bbox.width + arrowSize + 3;
        posTopY = posArrow - 0.5 * toolTipHeight;

        // make sure it's not out of boundaries
        posTopY = Math.min(canvasBbox.height - toolTipHeight - margin, Math.max(margin, posTopY));
        posArrow = Math.max(boundTopY, Math.min(boundBottomY, posArrow));
      }
      // Check if there is room to the left
      else if (bbox.x > totalToolTipWidth && posArrowY > boundTopY && posArrowY < boundBottomY) {
        pos = 'left';
        posArrow = posArrowY;
        posTopX = bbox.x - arrowToolTipWidth - 3;
        posTopY = posArrow - 0.5 * toolTipHeight;

        // make sure it's not out of boundaries
        posTopY = Math.min(canvasBbox.height - toolTipHeight - margin, Math.max(margin, posTopY));
        posArrow = Math.max(boundTopY, Math.min(boundBottomY, posArrow));
      }
      // there isn't enough room, so just use the right
      else {
        return null;
      }

      // calculate the different positions needed
      var leftX1 = posTopX;
      var leftX2 = leftX1 + curveRadius;
      var rightX1 = leftX2 + textWidth;
      var rightX2 = rightX1 + curveRadius;

      var topY1 = posTopY;
      var topY2 = topY1 + curveRadius;
      var bottomY1 = topY2 + textHeight;
      var bottomY2 = bottomY1 + curveRadius;

      var posArrowStart = posArrow - arrowSize;
      var posArrowEnd = posArrow + arrowSize;

      var path = '';
      path += 'M ' + leftX2 + ' ' + topY1;
      path += pos == 'bottom' ? 'L ' + posArrowStart + ' ' + topY1 + ' ' + posArrow + ' ' + (topY1 - arrowSize) + ' ' + posArrowEnd + ' ' + topY1 : '';
      path += 'L ' + rightX1 + ' ' + topY1;
      path += 'C ' + rightX2 + ' ' + topY1 + ' ' + rightX2 + ' ' + topY1 + ' ' + rightX2 + ' ' + topY2;
      path += pos == 'left' ? 'L ' + rightX2 + ' ' + posArrowStart + ' ' + (rightX2 + arrowSize) + ' ' + posArrow + ' ' + rightX2 + ' ' + posArrowEnd : '';
      path += 'L ' + rightX2 + ' ' + bottomY1;
      path += 'C ' + rightX2 + ' ' + bottomY2 + ' ' + rightX2 + ' ' + bottomY2 + ' ' + rightX1 + ' ' + bottomY2;
      path += pos == 'top' ? 'L ' + posArrowEnd + ' ' + bottomY2 + ' ' + posArrow + ' ' + (bottomY2 + arrowSize) + ' ' + posArrowStart + ' ' + bottomY2 : '';
      path += 'L ' + leftX2 + ' ' + bottomY2;
      path += 'C ' + leftX1 + ' ' + bottomY2 + ' ' + leftX1 + ' ' + bottomY2 + ' ' + leftX1 + ' ' + bottomY1;
      path += pos == 'right' ? 'L ' + leftX1 + ' ' + posArrowEnd + ' ' + (leftX1 - arrowSize) + ' ' + posArrow + ' ' + leftX1 + ' ' + posArrowStart : '';
      path += 'L ' + leftX1 + ' ' + topY2;
      path += 'C ' + leftX1 + ' ' + topY1 + ' ' + leftX1 + ' ' + topY1 + ' ' + leftX2 + ' ' + topY1;

      return {
        path: path,
        x: leftX2,
        y: topY2,
        textX: leftX2,
        textY: topY2 + offsetYText,
        textWidth: textWidth,
        textHeight: textHeight
      };
    },

    validateScale: function (el) {
      var scaleX = el.attr('data-scalex');
      var scaleY = el.attr('data-scaley');

      if (typeof(scaleX) == 'undefined' && typeof(scaleY) == 'undefined') {
        return;
      } else {
        scaleX = typeof(scaleX) == 'undefined' ? 1 : scaleX;
        scaleY = typeof(scaleY) == 'undefined' ? 1 : scaleY;

        el.children().each(function () {
          var childEl = $(this);
          var tagName = childEl.prop('tagName');
          var modX = childEl.attr('data-modx');
          var modY = childEl.attr('data-mody');

          if (tagName == 'line' && (modX != scaleX || modY != scaleY)) {
            util.doScale(childEl, scaleX, scaleY);
          }
        });
      }
    },

    doScale: function (el, x, y) {
      var tagName = el.prop('tagName');

      // get possible ignores
      var ignore = el.attr('data-ignorescale');
      var ignoreX = typeof(ignore) == 'undefined' ? false : ignore.indexOf('x') > -1;
      var ignoreY = typeof(ignore) == 'undefined' ? false : ignore.indexOf('y') > -1;

      if (ignoreX && ignoreY) {
        return;
      } else if (tagName == 'g') {
        el.children().each(function () {
          if (ignoreX) {
            x = 1;
          } else if (ignoreY) {
            y = 1;
          }

          util.doScale($(this), x, y);
          el.attr({'data-scalex': x, 'data-scaley': y});
        });
      } else if (tagName == 'line' || tagName == 'rect') {

        // get the older modifications
        var modX = el.attr('data-modx');
        modX = typeof(modX) == 'undefined' ? 1 : modX;
        var modY = el.attr('data-mody');
        modY = typeof(modY) == 'undefined' ? 1 : modY;
        if (x == modX && y == modY) {
          return;
        }

        if (tagName == 'line') {

          // get the values
          var x1 = el.attr('x1');
          x1 = typeof(x1) == 'undefined' ? 0 : x1;
          var x2 = el.attr('x2');
          x2 = typeof(x2) == 'undefined' ? 0 : x2;
          var y1 = el.attr('y1');
          y1 = typeof(y1) == 'undefined' ? 0 : y1;
          var y2 = el.attr('y2');
          y2 = typeof(y2) == 'undefined' ? 0 : y2;

          if (ignoreX) {
            el.attr({'data-mody': y, 'y1': (y1 / modY) * y, 'y2': (y2 / modY) * y});
          } else if (ignoreY) {
            el.attr({'data-modx': x, 'x1': (x1 / modX) * x, 'x2': (x2 / modX) * x});
          } else {
            el.attr({
              'data-modx': x,
              'data-mody': y,
              'x1': (x1 / modX) * x,
              'x2': (x2 / modX) * x,
              'y1': (y1 / modY) * y,
              'y2': (y2 / modY) * y
            });
          }
        } else if (tagName == 'rect') {

          // get the values
          var xPos = el.attr('x');
          xPos = typeof(xPos) == 'undefined' ? 0 : xPos;
          var yPos = el.attr('y');
          yPos = typeof(yPos) == 'undefined' ? 0 : yPos;
          var width = el.attr('width');
          width = typeof(width) == 'undefined' ? 0 : width;
          var height = el.attr('height');
          height = typeof(height) == 'undefined' ? 0 : height;

          if (ignoreX) {
            el.attr({'data-mody': y, 'y': (yPos / modY) * y, 'height': (height / modY) * height});
          } else if (ignoreY) {
            el.attr({'data-modx': x, 'x': (xPos / modX) * x, 'width': (width / modX) * width});
          } else {
            el.attr({
              'data-modx': x,
              'data-mody': y,
              'x': (xPos / modX) * x,
              'width': (width / modX) * x,
              'y': (yPos / modY) * y,
              'height': (height / modY) * y
            });
          }
        }
      } else {

        if (ignoreX) {
          svgLibrary.modifyTransform(el, 'scale', 1 + ',' + y);
        } else if (ignoreY) {
          svgLibrary.modifyTransform(el, 'scale', x + ',' + 1);
        } else {
          svgLibrary.modifyTransform(el, 'scale', x + ',' + y);
        }
      }
    }
  };

  /**
   * Default constructor
   */
  IntervalView = function () {
    this.intervalCollection = null;
    this.resolver = null;

    this.view = null;
    this.clipArea = null;
    this.background = null;
    this.grid = null;

    this.width = 0;
    this.height = 0;

    this.mouse = {
      clientX: null,
      clientY: null,
      pageX: null,
      pageY: null
    }
  };

  IntervalView.guidAttr = '_guid';
  IntervalView.gPositionAttr = '_pos';
  IntervalView.gColor = '_color';
  IntervalView.gRawAttr = '_raw';

  /**
   * Extended prototype
   */
  IntervalView.prototype = {
    defaultCfg: {
      showGrid: true,
      showBorder: true,
      showBackground: true,
      showPositionMarker: true,
      showIntervalMarker: true,
      showPositionToolTip: true,
      showIntervalToolTip: true, // TODO add this tool-tip

      coloring: {
        groupMapping: null,
        colorizer: function (interval, map, defaultColor) {

          // make sure there is something to do
          if (this.groupMapping == null || !$.isPlainObject(this.groupMapping)) {
            return defaultColor;
          }

          // get the value
          var raw = interval.get(IntervalView.gRawAttr);
          var group = map.get('group', raw);

          // if nothing is defined just return the default
          if (group == null) {
            return defaultColor;
          }

          // create the representative
          var strGroup = JSON.stringify(group);
          if (this.groupMapping.hasOwnProperty(strGroup)) {
            return this.groupMapping[strGroup];
          } else {
            return defaultColor;
          }
        }
      },

      tooltip: null,

      formatter: {
        tooltip: function (interval, map, textFormat, theme) {

          // get the values defined for the tool-tip
          var raw = interval.get(IntervalView.gRawAttr);
          var entries = map.get('tooltip', raw);

          // make sure we have a valid format, otherwise null is returned
          var formattedText = null;
          if (textFormat == null) {

            // make sure a tool-tip is defined, return null if none should be shown
            var entriesSize = entries.length;
            if ($.type(entries) != 'array' || entriesSize == 0) {
              return null;
            }

            formattedText = $(document.createElementNS('http://www.w3.org/2000/svg', 'text'));
            for (var i = 0; i < entriesSize; i++) {
              var tspan = $(document.createElementNS('http://www.w3.org/2000/svg', 'tspan'));
              tspan.text(util.format(entries[i]));

              tspan.attr('x', '0');
              tspan.attr('dy', util.getLineHeight(theme.tooltipSize));

              formattedText.append(tspan);
            }
          } else if ($.type(textFormat) == 'string') {
            formattedText = $(document.createElementNS('http://www.w3.org/2000/svg', 'text'));

            var spanReplace = function (text, textParser) {
              var textParser = textParser == null || typeof(textParser) == 'undefined' ? $('<div>' + text + '</div>') : textParser;
              var tspan = $(document.createElementNS('http://www.w3.org/2000/svg', 'tspan'));

              var content = textParser.contents();
              content.each(function () {
                var inner = $(document.createElementNS('http://www.w3.org/2000/svg', 'tspan'));
                inner.text(util.replace($(this).text(), entries));

                // clone the attributes
                if (this.nodeType == 1) {
                  inner.attr('style', $(this).attr('style'));
                }

                tspan.append(inner);
              });

              return tspan;
            };

            var lines = textFormat.split('\n');
            var linesSize = lines.length;
            for (var i = 0; i < linesSize; i++) {

              // format and replace span in the lines
              var text = lines[i].trim();
              var textParser = $('<div>' + text + '</div>');

              // check if we have spans defined
              var tspan = null;
              if (textParser.find('span').length > 0) {
                tspan = spanReplace(text, textParser);
              } else {
                tspan = $(document.createElementNS('http://www.w3.org/2000/svg', 'tspan'));
                tspan.text(util.replace(text, entries));
              }

              // position it
              tspan.attr('x', '0');
              tspan.attr('dy', util.getLineHeight(theme.tooltipSize));

              formattedText.append(tspan);
            }
          } else if ($.isFunction(textFormat)) {
            formattedText = this.tooltip(interval, map, textFormat(interval, map, interval.get(IntervalView.gRawAttr)), theme);
          } else {

            // unsupported type
            formattedText = null;
          }

          return formattedText;
        }
      },

      theme: {
        backgroundColor: '#FFFFFF',

        laneHeight: null,
        intervalPosition: 'middle',
        intervalHeight: 10,
        intervalColor: '#7CB5EC',
        intervalBorderColor: '#99C9F7',
        intervalBorderSize: 1,

        gridColor: '#D8D8D8',
        gridSize: 1,

        positionMarkerColor: '#D8D8D8',
        positionMarkerSize: 1,

        intervalMarkerOpacity: '0.3',
        intervalMarkerWidth: null,

        borderColor: '#D8D8D8',
        borderSize: 1,

        tooltipMargin: 2,
        tooltipArrow: 6,
        tooltipRadius: 3,
        tooltipSize: 11,

        tooltipTextColor: '#000000',

        intervalMarginInPx: null
      }
    },

    init: function (canvas, cfg) {
      this.opts = $.extend(true, {}, this.defaultCfg, cfg);

      // create the clipping area for this
      var svg;
      if (canvas.prop('tagName').toLowerCase() == 'svg') {
        svg = canvas;
      } else {
        svg = canvas.parents('svg');
      }

      // find the defs or create one
      var defs = svg.children('defs');
      if (defs.length == 0) {
        defs = $(document.createElementNS('http://www.w3.org/2000/svg', 'defs'));
        defs.prependTo(svg);
      }

      // add the clipping for this
      var clipPathId = util.randomId();
      var clipPath = $(document.createElementNS('http://www.w3.org/2000/svg', 'clipPath'));
      clipPath = $(document.createElementNS('http://www.w3.org/2000/svg', 'clipPath'));
      clipPath.attr('id', clipPathId);
      clipPath.appendTo(defs);
      this.clipArea = $(document.createElementNS('http://www.w3.org/2000/svg', 'rect'));
      this.clipArea.attr({'x': 0, 'y': 0});
      this.clipArea.appendTo(clipPath);

      // create the view
      this.view = $(document.createElementNS('http://www.w3.org/2000/svg', 'g'));
      this.view.attr('class', 'gantt-view-container');
      this.view.attr('clip-path', 'url(#' + clipPathId + ')');
      this.view.appendTo(canvas);

      // create the background of the view
      this.background = $(document.createElementNS('http://www.w3.org/2000/svg', 'g'));
      this.background.attr('class', 'gantt-view-background');
      this.background.appendTo(this.view);

      // create a rectangle for the background
      if (this.opts.showBackground && this.opts.theme.backgroundColor != null) {
        var bgRect = $(document.createElementNS('http://www.w3.org/2000/svg', 'rect'));
        bgRect.attr({'x': 0, 'y': 0, 'height': 1, 'width': 1});
        bgRect.css({'fill': this.opts.theme.backgroundColor});
        bgRect.appendTo(this.background);
      }

      // create the data container
      this.data = $(document.createElementNS('http://www.w3.org/2000/svg', 'g'));
      this.data.attr('class', 'gantt-view-data');
      this.data.appendTo(this.view);

      // create the foreground of the view
      this.foreground = $(document.createElementNS('http://www.w3.org/2000/svg', 'g'));
      this.foreground.attr('class', 'gantt-view-foreground');
      this.foreground.appendTo(this.view);

      // create a border if needed
      if (this.opts.showBorder) {
        var topLine = $(document.createElementNS('http://www.w3.org/2000/svg', 'line'));
        topLine.attr({'x1': 0, 'y1': 0, 'x2': 1, 'y2': 0});
        topLine.css({'stroke': this.opts.theme.borderColor, 'stroke-width': this.opts.theme.borderSize});
        topLine.appendTo(this.foreground);

        var bottomLine = $(document.createElementNS('http://www.w3.org/2000/svg', 'line'));
        bottomLine.attr({'x1': 0, 'y1': 1, 'x2': 1, 'y2': 1});
        bottomLine.css({'stroke': this.opts.theme.borderColor, 'stroke-width': this.opts.theme.borderSize});
        bottomLine.appendTo(this.foreground);

        var leftLine = $(document.createElementNS('http://www.w3.org/2000/svg', 'line'));
        leftLine.attr({'x1': 0, 'y1': 0, 'x2': 0, 'y2': 1});
        leftLine.css({'stroke': this.opts.theme.borderColor, 'stroke-width': this.opts.theme.borderSize});
        leftLine.appendTo(this.foreground);

        var rightLine = $(document.createElementNS('http://www.w3.org/2000/svg', 'line'));
        rightLine.attr({'x1': 1, 'y1': 0, 'x2': 1, 'y2': 1});
        rightLine.css({'stroke': this.opts.theme.borderColor, 'stroke-width': this.opts.theme.borderSize});
        rightLine.appendTo(this.foreground);
      }

      // create the container for the mouse-move stuff
      if (this.opts.showPositionMarker || this.opts.showIntervalMarker || this.opts.showPositionToolTip || this.opts.showIntervalToolTip) {
        this.mousemoveMask = $(document.createElementNS('http://www.w3.org/2000/svg', 'g'));
        this.mousemoveMask.attr('class', 'gantt-view-mousemovemask');
        this.mousemoveMask.appendTo(canvas);

        // create invisible mask for mouse-over
        var _ref = this;
        var moveArea = $(document.createElementNS('http://www.w3.org/2000/svg', 'rect'));
        moveArea.attr({'x': 0, 'y': 0, 'height': 1, 'width': 1});
        moveArea.css({'fill-opacity': 0.0});
        moveArea.on('mousemove', function (e) {

          var changed = _ref.mouse.pageX != e.pageX || _ref.mouse.pageY != e.pageY || _ref.mouse.clientX != e.clientX || _ref.mouse.clientY != e.clientY;
          if (changed) {
            _ref.mouse.pageX = e.pageX;
            _ref.mouse.pageY = e.pageY;
            _ref.mouse.clientX = e.clientX;
            _ref.mouse.clientY = e.clientY;

            _ref.showMarker();
          }
        });
        moveArea.on('mouseout', function (e) {
          _ref.mouse.pageX = null;
          _ref.mouse.pageY = null;
          _ref.mouse.clientX = null;
          _ref.mouse.clientY = null;

          _ref.hideMarker();
        });
        moveArea.appendTo(this.mousemoveMask);
      }
    },

    setData: function (intervalCollection, map) {
      this.intervalCollection = intervalCollection;
      this.map = map;
    },

    hideMarker: function () {
      if (this.positionMarker != null) {
        this.positionMarker.css('visibility', 'hidden');
      }
      if (this.intervalMarker != null) {
        this.intervalMarker.css('visibility', 'hidden');
      }
      if (this.tooltip != null) {
        this.tooltip.css('visibility', 'hidden');
      }
    },

    showMarker: function () {

      /*
       * Check some pre-conditions, i.e.:
       *  - check if anything has to be shown, i.e. if one of the 
       *    show... is configured
       *  - there is no mouse-mask available
       *  - make sure the mouse is within the view at all
       */
      // make sure the mouse is within the view at all, otherwise just return
      if (!this.opts.showPositionMarker && !this.opts.showIntervalMarker && !this.opts.showPositionToolTip && !this.opts.showIntervalToolTip) {
        return;
      } else if (typeof(this.mousemoveMask) == 'undefined' || this.mousemoveMask == null) {
        return;
      } else if (this.mouse.clientX == null) {
        return;
      }

      /*
       * Check if an interval is selected by the current mouse-position.
       */
      var interval = null;
      var el = null;
      if (this.opts.showIntervalMarker || this.opts.showIntervalToolTip) {

        /*
         * Determine the currently element selected on the canvas, because of 
         * the order this will be an interval, if one is available.
         */
        this.mousemoveMask.hide();
        var child = $(document.elementFromPoint(this.mouse.clientX, this.mouse.clientY));
        this.mousemoveMask.show();

        /*
         * Check if we really selected an interval and determine the data of
         * the DOM element.
         */
        var idx = child.attr('data-idx');
        if ($.isNumeric(idx)) {
          interval = this.intervals[idx];
          el = child;
        }
      }

      this.showPositionMarker();
      this.showIntervalMarker(el, interval);
      this.showToolTip(el, interval);
    },

    showPositionMarker: function () {

      if (this.opts.showPositionMarker) {
        if (this.positionMarker == null) {
          this.positionMarker = $(document.createElementNS('http://www.w3.org/2000/svg', 'line'));
          this.positionMarker.attr({'data-ignorescale': 'x', 'x1': 0, 'x2': 0, 'y1': 0, 'y2': 1});
          this.positionMarker.css({
            'stroke': this.opts.theme.positionMarkerColor,
            'stroke-width': this.opts.theme.positionMarkerSize
          });
          this.positionMarker.appendTo(this.background);

          // make sure the scaling is right
          util.validateScale(this.background);
        }

        // position the marker and show it
        var relPos = this.mouse.pageX - this.mousemoveMask.offset().left;
        this.positionMarker.attr({'x1': relPos, 'x2': relPos});
        this.positionMarker.css('visibility', 'visible');
      }
    },

    showIntervalMarker: function (el, interval) {

      if (this.opts.showIntervalMarker) {
        if (el == null) {
          if (this.intervalMarker != null) {
            this.intervalMarker.css('visibility', 'hidden');
          }
        } else {

          // create the intervalMarker if none is available so far
          if (this.intervalMarker == null) {
            this.intervalMarker = $(document.createElementNS('http://www.w3.org/2000/svg', 'rect'));
            this.intervalMarker.attr({'data-ignorescale': 'xy'});
            this.intervalMarker.css({
              'stroke-width': 0,
              'fill': this.opts.theme.backgroundColor,
              'opacity': this.opts.theme.intervalMarkerOpacity
            });
            this.intervalMarker.appendTo(this.background);
          }

          var offset = this.opts.theme.intervalMarkerWidth == null ? Math.max(0.15 * this.opts.theme.intervalHeight) : this.opts.theme.intervalMarkerWidth;
          var color = interval.get(IntervalView.gColor);
          bbox = el.get(0).getBBox();
          this.intervalMarker.attr({
            'x': bbox.x - offset,
            'y': bbox.y - offset,
            'width': bbox.width + 2 * offset,
            'height': bbox.height + 2 * offset
          });
          this.intervalMarker.css({'visibility': 'visible', 'fill': color});
        }
      }
    },

    showToolTip: function (el, interval) {

      if (this.opts.showIntervalToolTip) {

        if (el == null) {
          if (this.tooltip != null) {
            this.tooltip.css('visibility', 'hidden');
          }
        } else {

          // create the tooltip if none is available so far
          var border, shadowInner, shadow, shadowOuter;
          if (this.tooltip == null) {

            // the tool-tip is a group so create one
            this.tooltip = $(document.createElementNS('http://www.w3.org/2000/svg', 'g'));
            this.tooltip.attr({'class': 'gantt-view-tooltip', 'data-ignorescale': 'xy'});
            this.tooltip.appendTo(this.foreground);

            // create the shadow
            shadowOuter = util.createShadow('gantt-view-tooltip-shadow-outer', 0.05, 5);
            shadowOuter.appendTo(this.tooltip);
            shadow = util.createShadow('gantt-view-tooltip-shadow', 0.1, 3);
            shadow.appendTo(this.tooltip);
            shadowInner = util.createShadow('gantt-view-tooltip-shadow-inner', 0.2, 1);
            shadowInner.appendTo(this.tooltip);

            // create the border for the tool-tip
            border = $(document.createElementNS('http://www.w3.org/2000/svg', 'path'));
            border.attr({'id': 'gantt-view-tooltip-border'});
            border.css({'stroke-width': 1, 'opacity': 0.9, 'fill': '#EEEEEE'});
            border.appendTo(this.tooltip);
          } else {
            border = this.tooltip.children('#gantt-view-tooltip-border');
            shadowInner = this.tooltip.children('#gantt-view-tooltip-shadow-inner');
            shadow = this.tooltip.children('#gantt-view-tooltip-shadow');
            shadowOuter = this.tooltip.children('#gantt-view-tooltip-shadow-outer');
          }

          var text = this.opts.formatter.tooltip(interval, this.map, this.opts.tooltip, this.opts.theme);
          if (text == null || typeof(text) == 'undefined' || !text.is('text')) {
            this.tooltip.css('visibility', 'hidden');
          } else {

            // set some properties
            text.css({
              'fontSize': this.opts.theme.tooltipSize + 'px',
              'fill': this.opts.theme.tooltipTextColor,
              'color': this.opts.theme.tooltipTextColor,
              'cursor': 'default'
            });

            // get the path
            var path = util.createToolTipPath(this.mousemoveMask, el, this.mouse, text, this.opts.theme);
            if (path == null) {
              this.tooltip.css('visibility', 'hidden');
            } else {
              text.attr('transform', 'translate(' + path.x + ',0)');

              // format the tool-tip for the current interval
              shadowInner.attr({'d': path.path});
              shadow.attr({'d': path.path});
              shadowOuter.attr({'d': path.path});
              border.attr({'d': path.path});
              border.css({'stroke': interval.get(IntervalView.gColor)});

              // add the text
              this.tooltip.children('text').remove();
              text.attr({x: path.textX, y: path.textY});
              this.tooltip.append(text);

              // show it
              this.tooltip.css('visibility', 'visible');
            }
          }
        }
      }
    },

    setPosition: function (x, y) {

      /*
       * Nicer sharper look, see:
       * http://stackoverflow.com/questions/18019453/svg-rectangle-blurred-in-all-browsers
       */
      x = Math.floor(x) + 0.5;
      y = Math.floor(y) + 0.5;

      var translate = x + ', ' + y;

      svgLibrary.modifyTransform(this.view, 'translate', translate);
      svgLibrary.modifyTransform(this.mousemoveMask, 'translate', translate);
    },

    setSize: function (width, height, force) {
      width = typeof(width) == 'undefined' || width == null ? this.width : width;
      height = typeof(height) == 'undefined' || height == null ? this.height : height;
      force = typeof(force) == 'undefined' || force == null ? false : force;

      // check if we have a change or if it was forced to update
      var changed = this.width != width || this.height != height;
      if (!force && !changed) {
        return;
      } else {
        this.width = width;
        this.height = height;
      }
      this.clipArea.attr({'width': width, 'height': height});

      // modify the different groups
      var groups = [this.background, this.foreground, this.mousemoveMask, this.grid];
      $.each(groups, function (idx, val) {
        if (val != null) {
          util.doScale(val, width, height);
        }
      });

      // just trigger the final drawing as finished
      if (changed) {
        this.setView(null, null, null, null, true);
        this.view.trigger('sizechanged', this);
      }
    },

    setView: function (start, end, top, bottom, force) {
      force = typeof(force) == 'undefined' || force == null ? false : force;
      start = typeof(start) == 'undefined' || start == null ? this.start : start;
      end = typeof(end) == 'undefined' || end == null ? this.end : end;
      top = typeof(top) == 'undefined' || top == null ? this.top : top;
      bottom = typeof(bottom) == 'undefined' || bottom == null ? this.bottom : bottom;

      // make sure the values are correct
      var changed = this.start != start || this.end != end || this.top != top || this.bottom != bottom;
      if (!force && !changed) {
        return;
      } else {
        this.start = start;
        this.end = end;
        this.top = top;
        this.bottom = bottom;
      }

      // check validity and data availability
      var isValid = start != null && end != null && top != null && bottom != null && this.resolver != null && this.intervalCollection != null;
      var hasData = this.intervalCollection != null && this.intervalCollection.size() > 0;
      if (!isValid || !hasData) {
        return;
      }

      // determine the relevant data
      this.intervals = this.intervalCollection.overlap(start, end);
      this.intervals.sort(function (int1, int2) {
        return int1.compare(int2);
      });

      // hide any selection so far
      this.hideMarker();

      // calculate height, laneHeight, margin and offset
      var height = this.opts.theme.intervalBorderSize * 2 + this.opts.theme.intervalHeight;
      var swimlaneHeight = Math.max(height, this.opts.theme.laneHeight == null ? 1.5 * height : this.opts.theme.laneHeight);
      var swimlanesCount = this.height / swimlaneHeight;
      var intervalMarginInPx = this.opts.theme.intervalMarginInPx == null ? 0.5 * swimlaneHeight : this.opts.theme.intervalMarginInPx;
      var offset = -1 * top * swimlaneHeight;
      if (this.opts.theme.intervalPosition == 'top') {
        offset += 0;
      } else if (this.opts.theme.intervalPosition == 'bottom') {
        offset += swimlaneHeight - height;
      } else {
        offset += 0.5 * (swimlaneHeight - height);
      }

      // draw the lines
      if (this.opts.showGrid) {
        this.drawSwimlanes((Math.floor(top) - top) * swimlaneHeight, swimlanesCount, swimlaneHeight);
      }

      // iterate over intervals and create a 'new' or 'reuse' one
      var swimlanesTotal = 0;
      var intervalsLen = this.intervals.length;
      var swimlanesXPoses = [];
      var processId = util.randomId();
      for (var i = 0; i < intervalsLen; i++) {
        var interval = this.intervals[i];

        // determine the x-position and width
        var x1 = this.resolver.getRelativePixelPos(interval.start);
        var x2 = this.resolver.getRelativePixelPos(interval.end);
        var width = x2 - x1;
        if (width < 1.0) {
          width = 1.0;
          x2 = x1 + width;
        }

        /*
         * Check if we currently have a swimlane.
         */
        var swimlane = interval.get(IntervalView.gPositionAttr);
        if (typeof(swimlane) == 'undefined' || swimlane == null) {
          swimlane = this.determineSwimlane(swimlanesXPoses, interval, x1, intervalMarginInPx);
        }
        swimlanesTotal = Math.max(swimlane + 1, swimlanesTotal);

        // mark the swimlane as blocked
        swimlanesXPoses[swimlane] = x2;

        // layout the representor, if visible
        if (swimlane >= Math.floor(top) && swimlane < Math.ceil(bottom)) {
          var borderedX = x1 + this.opts.theme.intervalBorderSize;
          var borderedWidth = Math.max(0.1, width - 2 * this.opts.theme.intervalBorderSize);
          this.layoutRepresentor(i, borderedX, swimlane * swimlaneHeight + offset, borderedWidth, processId);
        }
      }

      // remove all the unneeded lines
      this.data.children('[data-processid][data-processid!="' + processId + '"]').remove();

      // select again whatever is covered now
      this.showMarker();

      // fire the view-change event
      this.view.trigger('viewchange', {
        start: start,
        end: end,
        top: top,
        bottom: bottom,
        swimlanesView: swimlanesCount,
        swimlanesTotal: swimlanesTotal
      });
    },

    drawSwimlanes: function (offset, swimlanesCount, swimlaneHeight) {

      // only draw new lines if changed
      if (this.swimlanesCount != swimlanesCount || this.swimlanesHeight != swimlaneHeight) {
        if (this.grid == null) {
          this.grid = $(document.createElementNS('http://www.w3.org/2000/svg', 'g'));
          this.grid.attr('class', 'gantt-view-grid');
          this.background.children(':first').after(this.grid);
        }

        // remove the grid, because it was changed
        this.grid.empty();

        for (var i = 0; i < swimlanesCount + 1; i++) {
          var line = $(document.createElementNS('http://www.w3.org/2000/svg', 'line'));
          var y = swimlaneHeight * i;

          line.attr({'x1': 0, 'y1': y, 'x2': 1, 'y2': y, 'data-ignorescale': 'y'});
          line.css({'stroke': this.opts.theme.gridColor, 'stroke-width': this.opts.theme.gridSize});

          line.appendTo(this.grid);
        }
        util.validateScale(this.grid);
      }

      // position the grid according to the defined offset
      svgLibrary.modifyTransform(this.grid, 'translate', '0, ' + offset);
    },

    layoutRepresentor: function (idx, x, y, width, processId) {
      var interval = this.intervals[idx];

      // check if we have a guid
      var guid = interval.get(IntervalView.guidAttr);

      // get the representor for the guid
      var representor = null;
      if (typeof(guid) == 'undefined' || guid == null) {
        guid = util.randomId();
        interval.set(IntervalView.guidAttr, guid);
      } else {
        representor = this.data.children('#' + guid);
      }

      // generate a new representor if we didn't find one or none was there
      if (representor == null || representor.length == 0) {

        // get the color and keep it if we got it
        var color = interval.get(IntervalView.gColor);
        if (typeof(color) == 'undefined' || color == null) {
          color = this.opts.coloring.colorizer(interval, this.map, this.opts.theme.intervalColor);
          interval.set(IntervalView.gColor, color);
        }

        representor = $(document.createElementNS('http://www.w3.org/2000/svg', 'rect'));
        representor.attr({'id': guid, 'height': this.opts.theme.intervalHeight});
        representor.css({
          'stroke': this.opts.theme.intervalBorderColor, 'stroke-width': this.opts.theme.intervalBorderSize,
          'fill': color
        });

        representor.appendTo(this.data);
      }
      representor.attr({'data-processid': processId, 'data-idx': idx});

      // position the representor
      representor.attr({'x': x, 'y': y, 'width': width});
    },

    determineSwimlane: function (swimlanesXPoses, interval, xPos, intervalMarginInPx) {
      var swimlanesLen = swimlanesXPoses.length;

      // check the swimlanes
      var swimlane = null;
      for (var k = 0; k < swimlanesLen; k++) {

        // get the next available position in the lane
        var x = swimlanesXPoses[k];
        x = typeof(x) != 'number' || x == 0 ? 0 : x + intervalMarginInPx;

        // check if the position is valid
        if (x < xPos) {
          swimlane = k;
          break;
        }
      }

      // create a new swimlane if none is available
      if (swimlane == null) {
        swimlane = swimlanesLen;
      }

      // set the selected position for the interval
      interval.set(IntervalView.gPositionAttr, swimlane);

      return swimlane;
    },

    setResolver: function (resolver) {
      this.resolver = resolver;
    },

    getSize: function () {
      return {'width': this.width, 'height': this.height};
    },

    on: function (event, handler) {
      this.view.on(event, handler);
    },

    off: function (event, handler) {
      this.view.off(event, handler);
    },
  };

  return IntervalView;
});
define('net/meisen/ui/gantt/svg/SvgIllustrator',['jquery', 'net/meisen/general/date/DateLibrary'
        , 'net/meisen/general/interval/IntervalCollection'
        , 'net/meisen/general/interval/Interval'
        , 'net/meisen/ui/gantt/svg/Scrollbar'
        , 'net/meisen/ui/gantt/svg/TimeAxis'
        , 'net/meisen/ui/gantt/svg/IntervalView'],
    function ($, datelib
        , IntervalCollection
        , Interval
        , Scrollbar
        , TimeAxis
        , IntervalView) {

        /*
         * Default constructor...
         */
        SvgIllustrator = function () {
            this.layoutStatus = {};
            this.resetStatus();
        };

        /*
         * Extended prototype
         */
        SvgIllustrator.prototype = {
            defaultCfg: {
                theme: {
                    fontFamily: '"Lucida Grande", "Lucida Sans Unicode", Arial, Helvetica, sans-serif',
                    fontSize: '12px'
                },
                general: {
                    margin: 2
                },
                /*
                 * The view is passed to the view as configuration. Therefore
                 * all settings of the view can be applied here.
                 */
                view: {},
                /*
                 * The axis is passed to the time-axis as configuration. Therefore
                 * all settings of the axis can be applied here.
                 */
                axis: {
                    /*
                     * The viewSize determines how many entries are on
                     * one view. If null the viewSize varies depending on
                     * the defined granularity.
                     */
                    viewSize: null,
                    /*
                     * The left and right padding of the axis.
                     */
                    padding: 100
                },
                scrollbars: {
                    vertical: {
                        hideOnNoScroll: false
                    },
                    horizontal: {
                    }
                }
            },

            init: function (panel, cfg) {
                this.opts = $.extend(true, {}, this.defaultCfg, cfg);

                this.panel = panel;
                this.panel.empty();

                this.intervalCollection = new IntervalCollection();

                this.canvas = $(document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
                this.canvas.attr('version', '1.1');
                this.canvas.css('fontFamily', this.opts.theme.fontFamily);
                this.canvas.css('fontSize', this.opts.theme.fontSize);
                this.canvas.css('cursor', 'default');
                this.canvas.appendTo(this.panel);

                // observe the resize event
                var _ref = this;
                this.panel.on('sizechanged', function (event, data) {

                    // make sure that the event was triggered for this
                    if (event.target == this) {
                        _ref.resize(data.width, data.height);
                    }
                });
                this.canvas.on('layoutable', function () {
                    _ref.layout();

                    // trigger the final layout
                    _ref.canvas.trigger('finishedLayouting');
                });

                // create a scrollbar for the time-axis
                this.scrollbar = new Scrollbar('horizontal');
                this.scrollbar.init(this.canvas, this.opts.scrollbars.horizontal);
                this.scrollbar.on('viewchange', function (event, data) {
                    _ref.timeaxis.setView(data.position, data.size, data.total);
                });
                this.scrollbar.on('sizechanged', function (event, data) {
                    _ref.setLayoutStatus('scrollbar', true);
                });

                // create the axis
                this.timeaxis = new TimeAxis();
                this.timeaxis.init(this.canvas, this.opts.axis);
                this.timeaxis.on('viewchange', function (event, data) {
                    _ref.intervalview.setView(data.rawstart, data.rawend, null, null, _ref.timeaxis);
                });
                this.timeaxis.on('sizechanged', function (event, data) {
                    _ref.setLayoutStatus('timeaxis', true);
                });

                // create a scrollbar for the view's swim-lanes
                this.scrollbar2 = new Scrollbar('vertical');
                this.scrollbar2.init(this.canvas, this.opts.scrollbars.vertical);
                this.scrollbar2.on('viewchange', function (event, data) {
                    _ref.intervalview.setView(null, null, data.position, data.position + data.size, _ref.timeaxis);
                });
                this.scrollbar2.bindToWheel(this.panel);

                // create the view
                this.intervalview = new IntervalView();
                this.intervalview.setResolver(this.timeaxis);
                this.intervalview.init(this.canvas, this.opts.view);
                this.intervalview.on('viewchange', function (event, data) {
                    _ref.scrollbar2.setView(data.top, data.swimlanesView, data.swimlanesTotal);
                });

                // initialize the scrollbar2
                this.scrollbar2.setView(0, 1, 1);
            },

            layout: function () {
                var canvasSize = this.getSize();

                var totalHeight = canvasSize.height - 2 * this.opts.general.margin;
                var totalWidth = canvasSize.width - 2 * this.opts.general.margin;

                var totalPosX = this.opts.general.margin;
                var totalPosY = this.opts.general.margin;

                var timeaxisSize = this.timeaxis.getSize();
                var scrollbarSize = this.scrollbar.isVisible() ? this.scrollbar.getSize() : {height: 0, width: 0};

                var scrollbarLeft = totalPosX;
                var scrollbarTop = totalPosY + totalHeight - scrollbarSize.height;
                this.scrollbar.setPosition(scrollbarLeft, scrollbarTop);

                var timeaxisLeft = scrollbarLeft + this.opts.axis.padding * 0.5;
                var timeaxisTop = scrollbarTop - timeaxisSize.height - 5; // add 5 pixel margin

                this.timeaxis.setPosition(timeaxisLeft, timeaxisTop);

                // set the new size and position of the view
                var intervalviewLeft = timeaxisLeft;
                var intervalviewTop = totalPosY;
                var intervalviewWidth = Math.max(0, totalWidth - this.opts.axis.padding);
                var intervalviewHeight = Math.max(0, timeaxisTop - intervalviewTop);
                this.intervalview.setSize(intervalviewWidth, intervalviewHeight);
                this.intervalview.setPosition(intervalviewLeft, intervalviewTop);

                // set the new size and position of the scrollbar2
                this.scrollbar2.setPosition(intervalviewLeft + intervalviewWidth, intervalviewTop);
                this.scrollbar2.setExtent(intervalviewHeight);
            },

            resetStatus: function () {
                this.layoutStatus.intervalview = true;
                this.layoutStatus.timeaxis = false;
                this.layoutStatus.scrollbar = false;
                this.layoutStatus.scrollbar2 = true;
            },

            setLayoutStatus: function (entity, value) {
                this.layoutStatus[entity] = value;

                var status = true;
                for (var property in this.layoutStatus) {
                    if (this.layoutStatus.hasOwnProperty(property)) {
                        if (this.layoutStatus[property] === false) {
                            status = false;
                            break;
                        }
                    }
                }

                if (status) {
                    this.canvas.trigger('layoutable');
                    this.resetStatus();
                }
            },

            resize: function (width, height) {
                this.panel.css('width', width);
                this.panel.css('height', height);

                this.canvas.width(width);
                this.canvas.height(height);
                this.canvas.attr('width', width);
                this.canvas.attr('height', height);

                width = width - 2 * this.opts.general.margin;
                height = height - 2 * this.opts.general.margin;

                this.scrollbar.setExtent(width);
                this.timeaxis.setWidth(width - this.opts.axis.padding);

                this.layout();
            },

            draw: function (timeaxisDef, records, map) {

                // get the records into a usable data-structure
                this.map = map;
                this.intervalCollection.clear();
                var intervals = [];
                for (var i = 0; i < records.length; i++) {
                    var record = records[i];

                    var start = record[map.start];
                    var end = record[map.end];

                    start = start === null || typeof start === 'undefined' ? timeaxisDef.start : start;
                    end = end === null || typeof end === 'undefined' ? timeaxisDef.end : end;

                    var interval = new Interval(start, end);
                    interval.set(IntervalView.gRawAttr, record);
                    intervals.push(interval);
                }
                this.intervalCollection.insertAll(intervals);

                // set the data of the intervalView
                this.intervalview.setData(this.intervalCollection, this.map);

                // set the axis
                var level = datelib.normalizeLevel(timeaxisDef.granularity);
                this.timeaxis.setAxis(timeaxisDef.start, timeaxisDef.end, level);

                // set the view of the scrollbar, everything else will be triggered
                this.scrollbar.setView(0, this.getViewSize(level), this.timeaxis.getAmountOfEntries());
            },

            getViewSize: function (level) {

                // the size is defined or calculated based on the level used
                var viewSize;
                if (typeof(this.opts.axis.viewSize) == 'undefined' || this.opts.axis.viewSize == null) {
                    switch (level) {
                        case 'y':
                            viewSize = 10;
                            break;
                        case 'm':
                            viewSize = 12;
                            break;
                        case 'd':
                            viewSize = 7;
                            break;
                        case 'h':
                            viewSize = 24;
                            break;
                        case 'mi':
                            viewSize = 1440;
                            break;
                        case 's':
                            viewSize = 60 * 1440;
                            break;
                    }
                } else {
                    viewSize = this.opts.axis.viewSize;
                }

                return viewSize;
            },

            getSize: function () {
                return {width: this.canvas.width(), height: this.canvas.height()};
            },

            on: function (event, handler) {
                this.canvas.on(event, handler);
            },

            off: function (event, handler) {
                this.canvas.off(event, handler);
            }
        };

        return SvgIllustrator;
    });
define('net/meisen/ui/svglibrary/required-svg/LoadingCircles',[], function () {

    /*
     * By Sam Herbert (@sherb), for everyone. More @ http://goo.gl/7AJzbL
     *
     * https://github.com/SamHerbert/SVG-Loaders/tree/master/svg-loaders
     */
    var svg = '';
    svg += '<svg width="58" height="58" viewBox="0 0 58 58" xmlns="http://www.w3.org/2000/svg">';
    svg += '<g fill="none" fill-rule="evenodd">';
    svg += '<g transform="translate(2 1)" stroke="#FFF" stroke-width="1.5">';
    svg += '<circle cx="42.601" cy="11.462" r="5" fill-opacity="1" fill="#fff">';
    svg += '<animate attributeName="fill-opacity" begin="0s" dur="1.3s" values="1;0;0;0;0;0;0;0" calcMode="linear" repeatCount="indefinite" />';
    svg += '</circle>';
    svg += '<circle cx="49.063" cy="27.063" r="5" fill-opacity="0" fill="#fff">';
    svg += '<animate attributeName="fill-opacity" begin="0s" dur="1.3s" values="0;1;0;0;0;0;0;0" calcMode="linear" repeatCount="indefinite" />';
    svg += '</circle>';
    svg += '<circle cx="42.601" cy="42.663" r="5" fill-opacity="0" fill="#fff">';
    svg += '<animate attributeName="fill-opacity" begin="0s" dur="1.3s" values="0;0;1;0;0;0;0;0" calcMode="linear" repeatCount="indefinite" />';
    svg += '</circle>';
    svg += '<circle cx="27" cy="49.125" r="5" fill-opacity="0" fill="#fff">';
    svg += '<animate attributeName="fill-opacity" begin="0s" dur="1.3s" values="0;0;0;1;0;0;0;0" calcMode="linear" repeatCount="indefinite" />';
    svg += '</circle>';
    svg += '<circle cx="11.399" cy="42.663" r="5" fill-opacity="0" fill="#fff">';
    svg += '<animate attributeName="fill-opacity" begin="0s" dur="1.3s" values="0;0;0;0;1;0;0;0" calcMode="linear" repeatCount="indefinite" />';
    svg += '</circle>';
    svg += '<circle cx="4.938" cy="27.063" r="5" fill-opacity="0" fill="#fff">';
    svg += '<animate attributeName="fill-opacity" begin="0s" dur="1.3s" values="0;0;0;0;0;1;0;0" calcMode="linear" repeatCount="indefinite" />';
    svg += '</circle>';
    svg += '<circle cx="11.399" cy="11.462" r="5" fill-opacity="0" fill="#fff">';
    svg += '<animate attributeName="fill-opacity" begin="0s" dur="1.3s" values="0;0;0;0;0;0;1;0" calcMode="linear" repeatCount="indefinite" />';
    svg += '</circle>';
    svg += '<circle cx="27" cy="5" r="5" fill-opacity="0" fill="#fff">';
    svg += '<animate attributeName="fill-opacity" begin="0s" dur="1.3s" values="0;0;0;0;0;0;0;1" calcMode="linear" repeatCount="indefinite" />';
    svg += '</circle>';
    svg += '</g>';
    svg += '</g>';
    svg += '</svg>';

    return svg;
});
define('net/meisen/ui/gantt/GanttChart',['jquery',
    'net/meisen/general/date/DateLibrary',
    'net/meisen/ui/gantt/svg/SvgIllustrator',
    'net/meisen/ui/svglibrary/SvgLibrary',
    'net/meisen/ui/svglibrary/required-svg/LoadingCircles'], function ($,
                                                                       datelib,
                                                                       SvgIllustrator,
                                                                       svglib,
                                                                       loadingImage) {

    /*
     * Hidden utilities, only used within the GanttChart.
     */
    var utilities = {
        generateMap: function (mapper, names) {
            var group = this.validateArray(mapper.group);
            var label = this.validateArray(mapper.label);
            var tooltip = this.validateArray(mapper.tooltip);

            var mappedGroup = this.createArray(group.length, -1);
            var mappedLabel = this.createArray(label.length, -1);
            var mappedTooltip = this.createArray(tooltip.length, -1);

            // create the initial map
            var map = {
                start: -1,
                end: -1,
                group: mappedGroup,
                label: mappedLabel,
                tooltip: mappedTooltip,

                val: function (name, record) {
                    if (record == null || !$.isArray(record) || record.length == 0) {
                        return;
                    }

                    for (var i = 0; i < names.length; i++) {
                        if (names[i] === name) {
                            return record[i];
                        }
                    }
                },

                get: function (type, record) {

                    // get the array
                    var arr = null;
                    if (type == 'group') {
                        arr = this.group;
                    } else if (type == 'label') {
                        arr = this.label;
                    } else if (type == 'tooltip') {
                        arr = this.tooltip;
                    } else {
                        arr = null;
                    }

                    // make sure we have something
                    if (arr == null || arr.length == 0) {
                        return [];
                    } else {
                        var len = arr.length;
                        var vals = [];
                        for (var i = 0; i < len; i++) {
                            var val = record[arr[i]];
                            vals.push(val);
                        }
                        return vals;
                    }
                }
            };

            // get the arrays to look through
            var arrays = [
                [group, mappedGroup],
                [label, mappedLabel],
                [tooltip, mappedTooltip]
            ];

            // look-up the names and the defined maps
            $.each(names, function (idx, val) {
                if (val == mapper.startname) {
                    map.start = idx;
                } else if (val == mapper.endname) {
                    map.end = idx;
                }

                $.each(arrays, function (nr, pair) {
                    var arrayIdx = $.inArray(val, pair[0]);
                    if (arrayIdx != -1) {
                        pair[1][arrayIdx] = idx;
                    }
                });
            });

            // validate the result, no -1 present anymore
            var validateValue = function (value) {
                if (!$.isNumeric(value) || parseInt(value) !== value || value < 0) {
                    throw Error('Mapping failed (reason: value="' + value + '", map="' + JSON.stringify(map) + '", names="' + JSON.stringify(names) + '")');
                }
            };
            $.each(map, function (key, value) {

                if ($.isFunction(value)) {
                    // nothing to do
                } else if ($.isArray(value)) {
                    $.each(value, function (idx, val) {
                        validateValue(val);
                    });
                } else {
                    validateValue(value);
                }
            });

            return map;
        },

        createArray: function (length, value) {
            var res = [];

            for (var i = 0; i < length; i++) {
                res[i] = value;
            }

            return res;
        },

        validateArray: function (array) {
            var res;

            if (!$.isArray(array)) {
                res = [];
                res.push(array);
            } else {
                res = array;
            }

            return res;
        },

        initTimeaxis: function (timeaxis, map, records) {
            var start = timeaxis.start;
            var end = timeaxis.end;

            var needStart = start == null || typeof(start) == 'undefined';
            var needEnd = end == null || typeof(end) == 'undefined';

            if (needStart || needEnd) {

                // TODO! What if we have numbers
                // get the needed values
                if (records == null || typeof(records) == 'undefined' || !$.isArray(records) || records.length == 0 ||
                    map == null || typeof(map) == 'undefined' || map.start == -1 || map.end == -1) {
                    start = needStart ? datelib.createUTC() : start;
                    end = needEnd ? datelib.createUTC(null, null, null, 23, 59, 0) : end;
                } else {
                    var max = -1;
                    var min = -1;

                    $.each(records, function (idx, val) {
                        var s = val[map.start].getTime();
                        var e = val[map.end].getTime();

                        if (needStart && $.isNumeric(s)) {
                            min = min == -1 || min > s ? s : min;
                        }

                        if (needEnd && $.isNumeric(e)) {
                            max = max == -1 || max < e ? e : max;
                        }
                    });

                    // get the start if needed
                    if (needStart) {
                        if (min == -1 && max == -1) {
                            start = datelib.createUTC();
                        } else if (min == -1) {
                            start = new Date(max);
                            start = datelib.createUTC(start.getUTCFullYear(), start.getUTCMonth() + 1, start.getUTCDate());
                        } else {
                            start = new Date(min);
                            start = datelib.createUTC(start.getUTCFullYear(), start.getUTCMonth() + 1, start.getUTCDate());
                        }
                    }

                    // get the end if needed
                    if (needEnd) {
                        if (min == -1 && max == -1) {
                            end = datelib.createUTC(null, null, null, 23, 59, 0);
                        } else if (max == -1) {
                            end = new Date(min);
                            end = datelib.createUTC(end.getUTCFullYear(), end.getUTCMonth() + 1, end.getUTCDate(), 23, 59, 0);
                        } else {
                            end = new Date(max);
                            end = datelib.createUTC(end.getUTCFullYear(), end.getUTCMonth() + 1, end.getUTCDate(), 23, 59, 0);
                        }
                    }
                }

                // set the new values
                return $.extend(true, timeaxis, {start: start, end: end});
            } else {
                return timeaxis;
            }
        }
    };

    /*
     * Default constructor...
     */
    GanttChart = function () {
    };

    /*
     * Extended prototype
     */
    GanttChart.prototype = {
        defaultCfg: {

            theme: {
                loadingBackgroundColor: '#CCCCCC',
                loadingBackgroundPosition: 'center center',
                loadingBackgroundRepeat: 'no-repeat',

                errorBackgroundColor: '#A30B1D'
            },

            illustrator: {
                factory: function () {
                    return new SvgIllustrator()
                },
                config: {}
            },

            position: 'center',

            throwException: false,

            data: {
                url: null,
                loader: null,
                postProcessor: function (data) {
                    if (!$.isArray(data.names) || !$.isArray(data.records)) {
                        return null;
                    } else {
                        return data;
                    }
                },
                mapper: {
                    startname: 'start',
                    endname: 'end',
                    group: [],
                    label: [],
                    tooltip: []
                },
                names: [],
                records: [],
                timeaxis: {
                    start: null,
                    end: null,
                    granularity: 'days'
                }
            }
        },

        init: function (selector, cfg) {
            this.opts = $.extend(true, {}, this.defaultCfg, cfg);

            selector = selector instanceof $ ? selector : $(selector);
            selector.children('.ganttchart').remove();

            this.container = $('<div></div>');
            this.container.addClass('ganttchart');
            this.container.css('overflow', 'hidden');
            this.container.css('position', 'relative');

            // set the positioning
            if (this.opts.position == 'center' || this.opts.position == 'left') {
                this.container.css('margin-right', 'auto');
            }
            if (this.opts.position == 'center' || this.opts.position == 'right') {
                this.container.css('margin-left', 'auto');
            }
            this.container.appendTo(selector);

            this.view = $('<div></div>');
            this.view.addClass('ganttview');
            this.view.css('position', 'absolute');
            this.view.css('overflow', 'hidden');
            this.view.css('zIndex', 0);
            this.view.appendTo(this.container);

            this.indicator = $('<div></div>');
            this.indicator.addClass('ganttloading');
            this.indicator.css('backgroundRepeat', this.opts.theme.loadingBackgroundRepeat);
            this.indicator.css('backgroundPosition', this.opts.theme.loadingBackgroundPosition);
            this.indicator.css('backgroundColor', this.opts.theme.loadingBackgroundColor);
            this.indicator.css('position', 'absolute');
            this.indicator.css('zIndex', 1000);
            svglib.setBackgroundImage(this.indicator, loadingImage);
            this.indicator.appendTo(this.container);

            this.error = $('<div></div>');
            this.error.addClass('gantterror');
            this.error.css('backgroundColor', this.opts.theme.errorBackgroundColor);
            this.error.css('position', 'absolute');
            this.error.css('zIndex', '500');
            this.error.appendTo(this.container);

            var _ref = this;
            $(this.view).on('load', function () {
                _ref.mask();
            }).on('renderStart', function () {
                _ref.mask();
            }).on('renderEnd', function () {
                _ref.unmask();
            }).on('error', function (event, data) {
                _ref.showError(data);
            }).on('changeTimeaxis', function (event, data) {
                _ref.changeTimeaxis(data.start, data.end, data.granularity, data.force);
            });

            // initialize the illustrator
            this.illustrator = this.opts.illustrator.factory();
            this.illustrator.init(this.view, this.opts.illustrator.config);
            this.illustrator.on('finishedLayouting', function () {
                _ref.view.trigger('renderEnd');
            });

            this.load();
        },

        mask: function () {
            if (this.masking != 'loading') {
                this.masking = 'loading';

                this.error.hide();
                this.indicator.show();
            }
        },

        unmask: function () {
            if (this.masking != null) {
                this.indicator.hide();
                this.error.hide();

                this.masking = null;
            }
        },

        resize: function (width, height) {
            this.container.css('width', width);
            this.container.css('height', height);

            var innerWidth = this.container.width();
            var innerHeight = this.container.height();
            this.indicator.css('width', innerWidth);
            this.indicator.css('height', innerHeight);
            this.error.css('width', innerWidth);
            this.error.css('height', innerHeight);

            // fire the resize event
            this.view.trigger('sizechanged', {width: innerWidth, height: innerHeight});
        },

        changeTimeaxis: function (start, end, granularity, force) {
            if (force || (typeof(granularity) != 'undefined' && this.opts.timeaxis.granularity != granularity)
                || (typeof(start) != 'undefined' && this.opts.timeaxis.start != start)
                || (typeof(end) != 'undefined' && this.opts.timeaxis.end != end)) {

                this.opts.timeaxis.start = typeof(start) != 'undefined' ? start : this.opts.timeaxis.start;
                this.opts.timeaxis.end = typeof(end) != 'undefined' ? end : this.opts.timeaxis.end;
                this.opts.timeaxis.granularity = typeof(granularity) != 'undefined' ? granularity : this.opts.timeaxis.granularity;

                this.render();
            }
        },

        load: function () {
            var _ref = this;
            var postProcessor = function (data) {
                var postProcessedData = $.isFunction(_ref.opts.data.postProcessor) ? _ref.opts.data.postProcessor(data) : data;
                if (postProcessedData == null) {
                    _ref.view.trigger('error', {error: null, message: 'Postprocessing of data failed', nr: '1001'});
                } else {
                    _ref.render(postProcessedData);
                }
            };

            this.view.trigger('load');

            if ($.isFunction(this.opts.data.loader)) {
                this.opts.data.loader(function (data) {
                    postProcessor(data);
                }, function (e) {
                    _ref.view.trigger('error', {error: e, message: 'Unable to load data', nr: '1000'});
                });
            } else if (typeof(this.opts.data.url) == 'undefined' || this.opts.data.url == null) {
                this.render();
            } else {
                $.getJSON(this.opts.data.url).done(function (data) {
                    postProcessor(data);
                }).fail(function (error) {
                    _ref.view.trigger('error', {error: error, message: 'Unable to load data', nr: '1000'});
                });
            }
        },

        render: function (loaded) {

            // rendering will be started
            this.view.trigger('renderStart');

            // combine the loaded data and the data
            var data = $.extend(true, {}, this.opts.data, loaded);

            // make sure we have a valid time-axis
            var map;
            try {
                map = utilities.generateMap(data.mapper, data.names);
                data.timeaxis = utilities.initTimeaxis(data.timeaxis, map, data.records);
            } catch (error) {
                this.view.trigger('error', {error: error, message: 'Failed to initialize rendering', nr: '1002'});
                return;
            }

            // use a time-out to make sure that the mask is shown
            var _ref = this;
            window.setTimeout(function () {

                try {
                    _ref.illustrator.draw(data.timeaxis, data.records, map);
                } catch (error) {
                    _ref.view.trigger('error', {error: error, message: 'Failed to draw', nr: '1003'});
                }
            }, 50);
        },

        showError: function (data) {
            if (this.opts.throwException === true) {
                throw data.error;
            } else if (console && $.isFunction(console.error)) {
                console.error(data);
            }

            if (this.masking != 'error') {
                this.masking = 'error';

                this.indicator.hide();
                this.error.show();
            }
        },

        createSampleEnd: function (n) {
            n = typeof n !== n instanceof Date ? n : new Date();
            return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(), 23, 59, 0));
        },

        createSampleData: function (n, amount) {

            // just some stuff to create some sample time-intervals
            n = typeof n !== n instanceof Date ? n : new Date();
            var createDate = function (h, m, s) {
                return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(), h, m, s));
            };
            var createRecord = function (h1, m1, s1, h2, m2, s2, label) {
                return [
                    createDate(h1, m1, s1), createDate(h2, m2, s2), label
                ];
            };
            var rnd = function (min, max) {
                return Math.floor(min + Math.random() * (max - min));
            };

            var result = [];
            amount = typeof amount === 'number' ? amount : 5;
            for (var i = 0; i < amount; i++) {
                var sH = rnd(1, 20);
                var sM = rnd(1, 59);
                var sS = rnd(1, 59);
                var eH = rnd(sH + 1, 23);
                var eM = rnd(1, 59);
                var eS = rnd(1, 59);

                var start = sH * 60 * 60 + sM * 60 + sS;
                var end = eH * 60 * 60 + eM * 60 + eS;

                var duration = end - start;

                result.push(createRecord(sH, sM, sS, eH, eM, eS, duration + ' seconds'));
            }

            return result;
        }
    };

    /*
     * Add the plug-in functionality for jQuery
     */
    GanttChart.bind = function ($) {

        $.fn.ganttChart = function () {
            var charts = [];

            // get the arguments
            var args = Array.prototype.slice.call(arguments);

            // get the arguments
            var config = args.length == 1 && typeof(args[0]) == 'object' ? args[0] : null;

            // create a chart for each element, if we have a configuration defined
            this.each(function () {
                var el = $(this);
                var chart = el.data('ganttchart');

                if (config != null && (typeof(chart) == 'undefined' || chart == null)) {
                    chart = new GanttChart();
                    chart.init(el, config);
                    el.data('ganttchart', chart);
                    charts.push(chart);
                } else if (config == null && typeof(chart) != 'undefined' && chart != null) {
                    charts.push(chart);
                } else if (config == null && typeof(chart) != 'undefined' && chart != null) {
                    chart.init(el, config);
                    charts.push(chart);
                }
            });

            // make the resize function available
            this.resize = function (width, height) {
                $.each(charts, function () {
                    //noinspection JSPotentiallyInvalidUsageOfThis
                    this.resize(width, height);
                });
            };

            // make the changeGranularity function available
            this.changeTimeaxis = function (start, end, granularity, force) {
                $.each(charts, function () {
                    //noinspection JSPotentiallyInvalidUsageOfThis
                    this.changeTimeaxis(start, end, granularity, force);
                });
            };

            return this;
        };
    };

    // bind internally to the
    GanttChart.bind($);

    // some static stuff
    GanttChart.DateUtil = datelib;

    return GanttChart;
});
define('net/meisen/dissertation/ui/app/page/analysisquerymanager',[
        'jquery',
        'highcharts',
        'bootstrap3-typeahead',
        'bootstrap-colorpicker',
        'net/meisen/ui/gantt/GanttChart',
        'net/meisen/general/date/DateLibrary',
        'net/meisen/dissertation/ui/app/utilities',
        'net/meisen/dissertation/ui/app/model',
        'net/meisen/dissertation/ui/app/server/tidaAPI'
    ],
    function ($,
              highcharts,
              typeahead,
              colorpicker,
              ganttcharts,
              DateLibrary,
              util,
              model,
              tidaAPI) {

        // regular expressions to check what type of query we have
        var timeSeriesRegExp = /^\s*select\s+timeseries/i;
        var intervalRegExp = /^\s*select\s+records/i;

        var resize = function () {
            var $highcharts = $('#highcharts');

            if (!$highcharts.hasClass('hide') && $highcharts.length > 0) {
                var width = $highcharts.width();
                var height = $highcharts.height();

                $highcharts.children('#graph').highcharts().setSize(width, height, false);
            }

            var $ganttcharts = $('#ganttcharts');
            if (!$ganttcharts.hasClass('hide') && $ganttcharts.length > 0) {
                var width = $ganttcharts.width();
                var height = $ganttcharts.height();

                $ganttcharts.children('#graph').ganttChart().resize(width, height);
            }
        };

        // add a resize event to change the sizing of the charts
        $(window).resize(function () {
            resize();
        });

        return {
            showResult: function (query) {
                if (timeSeriesRegExp.test(query)) {
                    this.showTimeSeries(query);
                } else if (intervalRegExp.test(query)) {
                    this.showGanttChart(query);
                } else {
                    this.clean();
                }
            },

            showTimeSeries: function (query) {
                this.clean();

                var _ref = this;
                util.handleLoading(function (callback) {
                    tidaAPI.query(model.serverSettings.getCurrent(), model.session.getCurrent(), query, callback);
                }, function (status, data) {
                    if (!status) {
                        return;
                    }

                    var $container = $('#highcharts');
                    var $highchart = $('<div id="graph"></div>');
                    $highchart.appendTo($container);

                    // get the names of the entries
                    var categories = data.names;
                    var yAxisName = categories.shift();

                    // determine the size of the tickInterval
                    var tickInterval = 1;
                    while (Math.ceil(categories.length / tickInterval) > 20) {
                        tickInterval = tickInterval == 1 ? 5 : tickInterval + 5;
                    }

                    var series = [];
                    for (var i = 0; i < data.result.length; i++) {
                        var seriesData = data.result[i];
                        var seriesName = seriesData.shift();
                        series.push({
                            name: seriesName,
                            data: seriesData
                        });
                    }

                    $highchart.highcharts({
                        chart: {
                            type: 'line'
                        },
                        title: {
                            text: ''
                        },
                        xAxis: {
                            tickInterval: tickInterval,
                            categories: categories
                        },
                        yAxis: {
                            floor: 0,
                            title: {text: ''},
                            allowDecimals: false
                        },
                        plotOptions: {
                            line: {
                                animation: false
                            }
                        },
                        series: series
                    });

                    // show it and resize
                    $container.removeClass('hide');
                    $('#highchartsNav').removeClass('hide');
                    resize();

                }, 'Waiting for response to query...');
            },

            showGanttChart: function (query, settings) {
                var settings = typeof(settings) == 'undefined' || settings == null ? null : settings;
                this.clean();

                var _ref = this;
                util.handleLoading(function (callback) {
                    tidaAPI.query(model.serverSettings.getCurrent(), model.session.getCurrent(), query, callback);
                }, function (status, data) {
                    if (!status) {
                        return;
                    }

                    var $container = $('#ganttcharts');
                    var $ganttchart = $('<div id="graph"></div>');
                    $ganttchart.appendTo($container);

                    var queryInfo = data.additional.query;

                    // we have to parse the date of the server to be correct
                    for (var i = 0; i < data.result.length; i++) {
                        var record = data.result[i];

                        record[1] = DateLibrary.parseString(record[1], 'dd.MM.yyyy HH:mm:ss');
                        record[2] = DateLibrary.parseString(record[2], 'dd.MM.yyyy HH:mm:ss');
                    }

                    var names = data.names;
                    var tooltipFormatter = function (interval, map, record) {
                        var entries = map.get('tooltip', record);

                        var result = '';
                        var entriesSize = entries.length;
                        for (var i = 0; i < entriesSize; i++) {
                            var name = names[i];
                            var entry = '{' + (i + 1) + '}';

                            result += '<span style="font-weight: bold">' + name + '</span>: ' + entry;
                            result += '\n';
                        }

                        return result.trim();
                    };

                    $ganttchart.ganttChart({
                        // activate if debugging is necessary:
                        // throwException: true,
                        data: {
                            names: names,
                            records: data.result,
                            timeaxis: {
                                start: DateLibrary.parseString(queryInfo.interval.start, 'dd.MM.yyyy HH:mm:ss'),
                                end: DateLibrary.parseString(queryInfo.interval.end, 'dd.MM.yyyy HH:mm:ss'),
                                granularity: queryInfo.timeaxis.granularity
                            },
                            mapper: {
                                startname: '[START]',
                                endname: '[END]',
                                tooltip: names,
                                group: settings == null ? [] : settings.group,
                            }
                        },
                        illustrator: {
                            config: {
                                axis: {
                                    viewSize: 1440,
                                    tickInterval: 120
                                },
                                view: {
                                    showBorder: false,
                                    tooltip: tooltipFormatter,
                                    coloring: {
                                        groupMapping: settings == null ? null : settings.mappings,
                                    },
                                    theme: {
                                        intervalBorderSize: 0
                                    }
                                }
                            }
                        }
                    });

                    // modify the settings
                    _ref.modifyGanttChartSettings(data.names, $('#inputGroupDescriptor'));

                    // show it and resize
                    $container.removeClass('hide');
                    $('#ganttchartsNav').removeClass('hide');
                    resize();

                }, 'Waiting for response to query...');
            },

            clean: function () {
                var $ganttcharts = $('#ganttcharts');
                var $highcharts = $('#highcharts');
                var $charts = $highcharts.children('#graph');

                // clean-up any available high-chart
                if ($charts.length > 0) {
                    var highchart = $charts.highcharts();
                    if (highchart != null && typeof(highchart) != 'undefined') {
                        highchart.destroy();
                    }
                }

                // remove everything
                $highcharts.empty();
                $ganttcharts.empty();

                // hide it
                $highcharts.addClass('hide');
                $ganttcharts.addClass('hide');
                $('#highchartsNav').addClass('hide');
                $('#ganttchartsNav').addClass('hide');
            },

            /*
             * Gantt Chart Settings
             */
            modifyGanttChartSettings: function (names, $inputGroupDescriptor) {
                var descNames = $.grep(names, function (element, idx) {
                    if (element.indexOf('[') == 0) {
                        return false;
                    } else {
                        return true;
                    }
                });

                // add values to typeahead
                $inputGroupDescriptor.typeahead('destroy');
                $inputGroupDescriptor.typeahead({
                    source: descNames, autoSelect: true, minLength: 0
                });
            },

            initGanttChartSettings: function ($modal, $nav, $table, $descriptors, $acceptButton, $resetButton, $addGroupButton, $addMappingButton, $openColorPickerButton, $inputGroupDescriptor, $inputGroup, callback) {
                this.resetGanttChartSettings($nav, $acceptButton, $openColorPickerButton, $table, $descriptors);

                // remove all group descriptors
                $descriptors.empty();

                // add click event and validate
                var _ref = this;
                $.each($nav.children('[data-selector]'), function (idx, element) {
                        var $el = $(element);
                        var $selector = $($el.attr('data-selector'));

                        // add the click
                        $el.click(function () {
                            if ($el.hasClass('disabled')) {
                                return;
                            }
                            var $children = $nav.children('[data-selector]');

                            // reset everything
                            $children.removeClass('active');

                            // select the current one
                            $el.addClass('active');
                            $selector.removeClass('hide');

                            _ref.selectActiveGanttChartStep($nav);
                        })
                    }
                );

                // add a custom event used to trigger the adding
                $inputGroupDescriptor.bind('addGanttChartGroupDescriptor', function () {
                    _ref.addGanttChartGroupDescriptor($nav, $acceptButton, $descriptors, $table, $inputGroupDescriptor);
                });
                $addGroupButton.click(function () {
                    $inputGroupDescriptor.trigger('addGanttChartGroupDescriptor');
                });

                // add the color picker
                $openColorPickerButton.colorpicker({
                    align: 'left'
                });
                $openColorPickerButton.on('changeColor.colorpicker', function (event) {
                    var hexColor = event.color.toHex();
                    $openColorPickerButton.css('background', hexColor);
                    $openColorPickerButton.attr('data-color', hexColor);
                });
                this.setRandomColor($openColorPickerButton);

                // bind an event to the input
                $inputGroup.bind('addGanttChartMapping', function () {
                    _ref.addGanttChartMapping($nav, $acceptButton, $descriptors, $table, $openColorPickerButton, $inputGroup);
                });
                $addMappingButton.click(function () {
                    $inputGroup.trigger('addGanttChartMapping');
                });

                // add click to main buttons $acceptButton and $resetButton
                var setSettings = function (settings) {
                    $modal.modal('hide');

                    // apply the settings
                    callback(settings);
                };
                $acceptButton.click(function () {

                    var groups = $table.find('thead th[data-descriptor]');
                    var resGroups = [];
                    $.each(groups, function (idx, group) {
                        var $group = $(group);

                        // get the group value
                        var desc = $group.attr('data-descriptor');
                        resGroups.push(desc);
                    });

                    var mappings = $table.find('tbody tr');
                    var resMappings = {};
                    $.each(mappings, function (idx, mapping) {
                        $mapping = $(mapping);

                        // get the values defined for the mapping
                        var values = [];
                        $.each($mapping.find('td[data-value]'), function (idx, value) {
                            values.push('"' + $(value).attr('data-value') + '"');
                        });
                        var color = $mapping.find('td[data-color]').attr('data-color');

                        resMappings['[' + values.join(',') + ']'] = color;
                    });

                    setSettings({
                        group: resGroups,
                        mappings: resMappings
                    });
                });
                $resetButton.click(function () {
                    setSettings({});
                });

                // validate initially
                this.validateGanttChartSetting($nav, $acceptButton, $table, $descriptors);
            },

            resetGanttChartSettings: function ($nav, $acceptButton, $openColorPickerButton, $table, $descriptors) {
                $table.find('thead tr th:not(:first-child):not(:last-child)').remove();
                $table.children('tbody').empty();
                $descriptors.empty();

                $nav.children('[data-selector]').removeClass('active');
                $nav.children(':first-child').addClass('active');

                this.validateGanttChartSetting($nav, $acceptButton, $table, $descriptors);
                this.selectActiveGanttChartStep($nav);

                this.setRandomColor($openColorPickerButton);
            },

            setRandomColor: function ($openColorPickerButton) {
                if (typeof($openColorPickerButton.data('colorpicker')) == 'undefined') {
                    return;
                }

                var color = '#' + (Math.random() * 0xFFFFFF << 0).toString(16);
                $openColorPickerButton.colorpicker('setValue', color);
                $openColorPickerButton.colorpicker('update', true);
            },

            selectActiveGanttChartStep: function ($nav) {
                $.each($nav.children('[data-selector]'), function (idx, element) {
                    var $el = $(element);
                    var $selector = $($el.attr('data-selector'));

                    if ($el.hasClass('active')) {
                        $selector.removeClass('hide');
                    } else {
                        $selector.addClass('hide');
                    }
                });
            },

            validateGanttChartSetting: function ($nav, $acceptButton, $table, $descriptors) {
                var valid = true;

                // validate the descriptors selected
                if ($descriptors != null) {
                    if ($descriptors.children('[data-descriptor]').length == 0) {
                        $nav.children('[data-selector="#stepColorDefinition"]').addClass('disabled');
                        valid = false;
                    } else {
                        $nav.children('[data-selector="#stepColorDefinition"]').removeClass('disabled');
                    }
                } else {
                    valid = false;
                }

                // check the table
                if ($table != null) {
                    var $tbody = $table.children('tbody');
                    if ($tbody.children('tr').length == 0) {
                        valid = false;
                    } else if ($tbody.find('td:not([data-value])[data-descriptor]').size() > 0) {
                        valid = false;
                    }
                } else {
                    valid = false;
                }

                // overall
                if (valid) {
                    $acceptButton.removeAttr('disabled');
                } else {
                    $acceptButton.attr('disabled', '');
                }
            },

            addGanttChartGroupDescriptor: function ($nav, $acceptButton, $descriptors, $table, $inputGroupDescriptor) {
                var value = $inputGroupDescriptor.val();

                // check if a value was defined
                if (value.trim() == '') {
                    return;
                }
                // check if already added
                else if ($descriptors.children('[data-descriptor="' + value + '"]').size() > 0) {
                    return;
                }
                // check if the value is available
                else if (!this.isValidGroupDescriptor($inputGroupDescriptor)) {
                    return;
                }

                var _ref = this;
                var $entry = $('<a href="#" title="remove ' + value + '" data-descriptor="' + value + '"><span class="label label-primary">' + value + '</span></a><span>&nbsp;</span>');
                $descriptors.append($entry);
                var position = $descriptors.size();

                // modify the table
                var $thead = $table.children('thead');
                var $tbody = $table.children('tbody');

                var $theadEntry = $('<th data-descriptor="' + value + '" class="text-center">' + value + '</th>');
                $theadEntry.insertBefore($thead.find('tr :last-child'));

                // add missing values
                $.each($tbody.find('tr'), function (idx, element) {
                    var $el = $(element);
                    var $tbodyEntry = $('<td data-descriptor="' + value + '"></td>');
                    $tbodyEntry.insertBefore($el.children(':last-child'));
                });

                // add the remove event
                $entry.click(function () {
                    $entry.remove();
                    $theadEntry.remove();
                    $tbody.find('tr td[data-descriptor="' + value + '"]').remove();

                    _ref.validateGanttChartSetting($nav, $acceptButton, $table, $descriptors);
                });

                // remove the value
                $inputGroupDescriptor.val('');
                this.validateGanttChartSetting($nav, $acceptButton, $table, $descriptors);
            },

            isValidGroupDescriptor: function ($inputGroupDescriptor) {
                var value = $inputGroupDescriptor.val();
                var values = $inputGroupDescriptor.data('typeahead');
                values = values == null || typeof(values) == 'undefined' || !$.isArray(values.source) ? [] : values.source;

                return $.inArray(value, values) != -1;
            },

            addGanttChartMapping: function ($nav, $acceptButton, $descriptors, $table, $openColorPickerButton, $inputGroup) {
                var color = $openColorPickerButton.attr('data-color');
                var group = $inputGroup.val().split(',');

                // check the group
                var $thead = $table.children('thead');
                if (group.length != $thead.find('th').size() - 2) {
                    return;
                }

                var $tbody = $table.children('tbody');
                var tbodyEntry = '<tr>';
                tbodyEntry += '<td class="text-center"><button type="button" class="btn operator" aria-label="delete mapping"><span class="glyphicon glyphicon-trash" aria-hidden="true"></span></button></td>'

                var valid = [];
                $.each(group, function (idx, val) {
                    var value = val.trim();
                    var desc = $thead.find('th:nth-child(' + (idx + 2) + ')').attr('data-descriptor');
                    tbodyEntry += '<td data-value="' + value + '" data-descriptor="' + desc + '">' + value + '</td>';

                    // mark if the on is unique
                    valid.push('td:nth-child(' + (idx + 1) + ')[data-value="' + value + '"]');
                });
                tbodyEntry += '<td class="text-center" data-color="' + color + '"><span><i style="display: inline-block; width: 16px; height: 16px; vertical-align: text-top; background-color:' + color + '"></i></span></td>';
                tbodyEntry += '</tr>';

                // another entry already exists
                var all = null;
                $.each(valid, function (idx, selector) {
                    var tr = $tbody.find(selector).parent().toArray();
                    all = all == null ? tr : $(all).filter(tr);
                });

                // if we found a duplicate stop here
                if (all.length > 0) {
                    return;
                }

                var $tbodyEntry = $(tbodyEntry);
                $tbody.append($tbodyEntry);

                // add the remove functionality
                var _ref = this;
                $tbodyEntry.find('button').click(function () {
                    $(this).parent().parent().remove();
                    _ref.validateGanttChartSetting($nav, $acceptButton, $table, $descriptors);
                });

                // set a new value
                $inputGroup.val('');
                this.setRandomColor($openColorPickerButton);
                this.validateGanttChartSetting($nav, $acceptButton, $table, $descriptors);
            },

            createGanttChartSettings: function ($nav, $descriptors) {
                var settings = {};

                $.each($nav.children('[data-selector]'), function (idx, element) {
                    var $el = $(element);
                    var $selector = $($el.attr('data-selector'));

                    // handle each element
                    var id = $selector.attr('id');
                    if (id == 'stepGroupDescriptors') {
                        settings.group = [];

                        $.each($descriptors.children(), function (idx, element) {
                            var $el = $(element);
                            var desc = $el.attr('data-descriptor');
                            settings.group.push(desc);
                        });
                    } else if (id == 'stepColorDefinition') {

                    }
                });
            }
        }
    }
)
;

define('net/meisen/dissertation/ui/app/page/usermanager',[
    'jquery',
    'net/meisen/dissertation/ui/app/utilities',
    'net/meisen/dissertation/ui/app/model',
    'net/meisen/dissertation/ui/app/server/tidaAPI'
  ],
  function ($,
            util,
            model,
            tidaAPI) {

    return {
      reloadUsersAndRoles: function(tableUsers, tableRoles) {
        var _ref = this;
        var server = model.serverSettings.getCurrent();
        var session = model.session.getCurrent();

        tableUsers.empty();
        tableRoles.empty();

        // call the server to get the models
        var users = [];
        var roles = [];
        util.handleLoading(function (callback) {
          tidaAPI.getUsers(server, session, function(status, data) {
            if (status) {
              users = data;
              tidaAPI.getRoles(server, session, callback);
            } else {
              callback(status, data);
            }
          });
        }, function (status, data) {
          if (!status) return;

          roles = data;

          // add all the data
          $.each(users.result, function (index, value) {
            _ref.add(tableUsers, 'user', {name: value[0], username: value[0], roles: value[1], permissions: value[2]}, false);
          });
          $.each(roles.result, function (index, value) {
            _ref.add(tableRoles, 'role', {name: value[0], role: value[0], permissions: value[1]}, false);
          });

          _ref.sort(tableUsers);
          _ref.sort(tableRoles);
        }, 'Reloading models...');
      },

      add: function(table, type, value, sort) {
        var casedType = type.charAt(0).toUpperCase() + type.slice(1);

        var html = '';
        html += '<tr>';
        html += '  <td></td>';
        html += '  <td class="text-right">';
        html += '    <button type="button" class="btn operator" data-toggle="modal" data-target="#modalEdit' + casedType + '" data-backdrop="static" aria-label="edit ' + type + '"><span class="glyphicon glyphicon-pencil" aria-hidden="true"></span></button>';
        html += '    <button type="button" class="btn operator" data-toggle="modal" data-target="#modalDelete' + casedType + '" data-backdrop="static" aria-label="delete ' + type + '"><span class="glyphicon glyphicon-trash" aria-hidden="true"></span></button>';
        html += '  </td>';
        html += '</tr>';
        var row = $(html);
        this.set(row, value);

        // set the values of the model and append it
        row.appendTo(table);

        if (sort === true) {
          this.sort(table);
        }
      },

      set: function (row, data) {
        data = $.extend({}, row.data('entity'), data);

        // set the name
        row.children(':nth-child(1)').text(data.name);

        // set the new entity for the object
        row.data('entity', data);

        if (row.hasClass('info')) {
          // this.setNavBar($('#modelmanagement nav'), row);
        }
      },

      sort: function (table) {
        table.find('tr').sort(function (tr1, tr2) {
          var valTr1 = $(tr1).find('td:first').text();
          var valTr2 = $(tr2).find('td:first').text();

          return valTr1.toLowerCase() > valTr2.toLowerCase() ? 1 : -1;
        }).appendTo(table);
      }
    };
  });
define('net/meisen/dissertation/ui/app/page/datamanager',[
    'jquery',
    'net/meisen/dissertation/ui/app/utilities',
    'net/meisen/dissertation/ui/app/model',
    'net/meisen/dissertation/ui/app/server/tidaAPI'
  ],
  function ($,
            util,
            model,
            tidaAPI) {

    return {
      loadModel: function (modelId, $table) {
        var _ref = this;

        util.handleLoading(function (callback) {
          tidaAPI.loadData(model.serverSettings.getCurrent(), model.session.getCurrent(), modelId, 0, 20, callback);
        }, function (status, data) {
          if (!status) return;

          // add all the data
          _ref.showModelData($table, data);
        }, 'Reloading data of model "' + modelId + '"...');
      },

      showModelData: function ($table, data) {
        var $thead = $table.children('thead');
        var $tbody = $table.children('tbody');

        // remove everything we have
        $thead.empty();
        $tbody.empty();

        // create the header
        var htmlHead = '';
        htmlHead += '<tr>';

        $.each(data.names, function (index, header) {
          htmlHead += '<th class="text-center col-xs-1 col-md-1 col-lg-1">' + header + '</th>';
        });
        htmlHead += '</tr>';
        $thead.append($(htmlHead));

        // create the body
        var _ref = this;
        var modelId = data.additional.query.model;
        $.each(data.result, function (index, row) {
          var id = null;

          var htmlRow = '';
          $.each(row, function (index, value) {
            id = index == 0 ? value : id;
            htmlRow += '<td class="text-center col-xs-1 col-md-1 col-lg-1">' + value + '</td>';
          });
          htmlRow = '<tr data-id="' + id + '" data-model="' + modelId + '">' + htmlRow + '</tr>';

          var $htmlRow = $(htmlRow);
          $tbody.append($htmlRow);

          // add the click event
          $htmlRow.click(function () {
            _ref.toggleSelection($(this));
          });
        });
      },

      updateDbModal: function (modelId) {
        this.updateModel(modelId, 'divLoadDbLoadingIcon', 'divLoadDbLoadingFailed', 'formDbData', 'divDbFields', 'btnLoadFromDb');
      },


      updateCsvModal: function (modelId) {
        this.updateModel(modelId, 'divLoadCsvLoadingIcon', 'divLoadCsvLoadingFailed', 'formCsvData', 'divCsvFields', 'btnLoadFromCsv');
      },

      updateSingleModal: function (modelId) {
        this.updateModel(modelId, 'divLoadSingleLoadingIcon', 'divLoadSingleLoadingFailed', 'formSingleData', 'divSingleFields', 'btnLoadSingle');
      },

      updateModelModal: function (modelId) {
        this.showData('divLoadModelLoadingIcon', 'divLoadModelLoadingFailed', 'divModelData', 'btnLoadFromModel');
      },

      updateModel: function (modelId, loadId, failId, dataId, fieldsId, btnId) {
        var _ref = this;
        tidaAPI.getModelStructure(model.serverSettings.getCurrent(), model.session.getCurrent(), modelId, function (status, data) {
          var $loadingFailed = $('#' + failId);

          if (status) {
            var $divDbFields = $('#' + fieldsId);

            $.each(data, function (index, entry) {

              // skip the id
              if (entry.metatype == 'ID') {
                return;
              }

              var entryHtml = '';
              entryHtml += '<div class="form-group form-group-sm">';
              entryHtml += '<label for="input' + entry.name + '" class="col-sm-4 control-label">' + entry.name + '</label>';
              entryHtml += '<div class="col-sm-8">';
              entryHtml += '<input type="input" class="form-control" id="input' + entry.name + '" placeholder="' + entry.name + '" data-metatype="' + entry.metatype + '" data-id="' + entry.name + '">';
              entryHtml += '</div>';
              entryHtml += '</div>';
              $divDbFields.append($(entryHtml));
            });

            _ref.showData(loadId, failId, dataId, btnId);
          } else {
            _ref.showError(loadId, failId, btnId, 'Unable to determine model structure', data);
          }
        });
      },

      showLoading: function (loadId, failId, dataId, btnId) {
        $('#' + loadId).removeClass('hide');
        $('#' + failId).addClass('hide');
        if (dataId != null) {
          $('#' + dataId).addClass('hide');
        }
        $('#' + btnId).attr('disabled', '');
      },

      showError: function (loadId, failId, btnId, title, data) {
        $('#' + loadId).addClass('hide');

        var $loadingFailed = $('#' + failId);
        $loadingFailed.children('h4').text(title);
        $loadingFailed.children('div').text(util.getError(data));
        $loadingFailed.removeClass('hide');
        $('#' + btnId).attr('disabled', '');
      },

      showData: function (loadId, failId, dataId, btnId) {
        $('#' + loadId).addClass('hide');
        if (failId != null) {
          $('#' + failId).addClass('hide');
        }
        $('#' + dataId).removeClass('hide');
        $('#' + btnId).removeAttr('disabled');
      },

      reset: function (loadId, failId, dataId, btnId, fieldsId) {
        var $loadingFailed = $('#' + failId);

        $('#' + loadId).removeClass('hide');
        $loadingFailed.addClass('hide');

        if (dataId != null) {
          $('#' + dataId).addClass('hide');
        }

        $loadingFailed.children('h4').text('');
        $loadingFailed.children('div').text('');

        if (fieldsId != null) {
          $('#' + fieldsId).empty();
        }
        $('#' + btnId).attr('disabled', '');
      },

      resetDbModal: function () {
        this.reset('divLoadDbLoadingIcon', 'divLoadDbLoadingFailed', 'formDbData', 'btnLoadFromDb', 'divDbFields');
      },

      resetCsvModal: function () {
        this.reset('divLoadCsvLoadingIcon', 'divLoadCsvLoadingFailed', 'formCsvData', 'btnLoadFromCsv', 'divCsvFields');
      },

      resetSingleModal: function () {
        this.reset('divLoadSingleLoadingIcon', 'divLoadSingleLoadingFailed', 'formSingleData', 'btnLoadSingle', 'divSingleFields');
      },

      resetModelModal: function () {
        this.reset('divLoadModelLoadingIcon', 'divLoadModelLoadingFailed', 'divModelData', 'btnLoadFromModel', null);
      },

      loadDbData: function (modelId) {
        var $textarea = $('#formDbData textarea');
        var $inputs = $('#formDbData input');

        var connection = {
          driver: $inputs.filter('#inputDriver').val(),
          url: $inputs.filter('#inputJdbc').val(),
          username: $inputs.filter('#inputDbUsername').val(),
          password: $inputs.filter('#inputDbPassword').val()
        };
        var query = $textarea.val();
        var structure = this.getStructure($inputs);

        var _ref = this;
        this.showLoading('divLoadDbLoadingIcon', 'divLoadDbLoadingFailed', 'formDbData', 'btnLoadFromDb');
        tidaAPI.insertDbData(model.serverSettings.getCurrent(), model.session.getCurrent(), modelId, connection, query, structure, function (status, data) {
          if (status) {
            var $modalLoadFromDb = $('#modalLoadFromDb');
            $modalLoadFromDb.modal('hide');
            $modalLoadFromDb.attr('data-dorefresh', 'true');
          } else {
            _ref.showError('divLoadDbLoadingIcon', 'divLoadDbLoadingFailed', 'btnLoadFromDb', 'Failed to load data in model', data);
            _ref.showData('divLoadDbLoadingIcon', null, 'formDbData', 'btnLoadFromDb');
          }
        });
      },

      loadCsvData: function (modelId) {
        var $inputs = $('#formCsvData input');
        var structure = this.getStructure($inputs);
        var separator = $inputs.filter('#inputSeparator').val();

        var _ref = this;
        this.showLoading('divLoadCsvLoadingIcon', 'divLoadCsvLoadingFailed', 'formCsvData', 'btnLoadFromCsv');
        tidaAPI.uploadFile(model.serverSettings.getCurrent(), model.session.getCurrent(), $('#formCsvData'), function (status, data) {
          if (status) {
            tidaAPI.insertCsvData(model.serverSettings.getCurrent(), model.session.getCurrent(), modelId, data[0].fileName, separator, structure, function (status, data) {
              if (status) {
                var $modalLoadFromCsv = $('#modalLoadFromCsv');
                $modalLoadFromCsv.modal('hide');
                $modalLoadFromCsv.attr('data-dorefresh', 'true');
              } else {
                _ref.showError('divLoadCsvLoadingIcon', 'divLoadCsvLoadingFailed', 'btnLoadFromCsv', 'Failed to add CSV data', data);
                _ref.showData('divLoadCsvLoadingIcon', null, 'formCsvData', 'btnLoadFromCsv');
              }
            });
          } else {
            _ref.showError('divLoadCsvLoadingIcon', 'divLoadCsvLoadingFailed', 'btnLoadFromCsv', 'Failed to upload file to server', data);
            _ref.showData('divLoadCsvLoadingIcon', null, 'formCsvData', 'btnLoadFromCsv');
          }
        });
      },

      loadModelData: function (modelId) {
        var _ref = this;
        this.showLoading('divLoadModelLoadingIcon', 'divLoadModelLoadingFailed', 'divModelData', 'btnLoadFromModel');
        tidaAPI.insertModelData(model.serverSettings.getCurrent(), model.session.getCurrent(), modelId, function (status, data) {
          if (status) {
            var $modalLoadFromModel = $('#modalLoadFromModel');
            $modalLoadFromModel.modal('hide');
            $modalLoadFromModel.attr('data-dorefresh', 'true');
          } else {
            _ref.showError('divLoadModelLoadingIcon', 'divLoadModelLoadingFailed', 'btnLoadFromModel', 'Failed to load data from model', data);
            _ref.showData('divLoadModelLoadingIcon', null, 'divModelData', 'btnLoadFromModel');
          }
        });
      },

      loadSingleRecord: function (modelId) {
        var $inputs = $('#formSingleData input');
        var entries = this.getEntries($inputs);

        var _ref = this;
        this.showLoading('divLoadSingleLoadingIcon', 'divLoadSingleLoadingFailed', 'formSingleData', 'btnLoadSingle');
        tidaAPI.insertSingleRecord(model.serverSettings.getCurrent(), model.session.getCurrent(), modelId, entries, function (status, data) {
          if (status) {
            var $modalLoadSingle = $('#modalLoadSingle');
            $modalLoadSingle.modal('hide');
            $modalLoadSingle.attr('data-dorefresh', 'true');
          } else {
            _ref.showError('divLoadSingleLoadingIcon', 'divLoadSingleLoadingFailed', 'btnLoadSingle', 'Failed to insert record', data);
            _ref.showData('divLoadSingleLoadingIcon', null, 'formSingleData', 'btnLoadSingle');
          }
        });
      },

      deleteModelData: function ($table, $row, modelId, recordId) {
        var _ref = this;
        tidaAPI.deleteRecord(model.serverSettings.getCurrent(), model.session.getCurrent(), modelId, recordId, function (status, data) {
          if (status) {

            // remove the entry and update the nav
            _ref.toggleSelection(null);

            // remove the modal
            var $modalDeleteData = $('#modalDeleteData');
            $modalDeleteData.modal('hide');
            $modalDeleteData.attr('data-dorefresh', 'true');
          } else {
            _ref.showError('divDeleteDataLoadingIcon', 'divDeleteDataLoadingFailed', 'btnDeleteFromModel', 'Failed to delete record from model', data);
            _ref.showData('divDeleteDataLoadingIcon', null, 'divDeleteData', 'btnDeleteFromModel');
          }
        });
      },

      toggleSelection: function ($row) {
        if ($row == null || typeof($row) == 'undefined') {
          $('#datamanagement nav').find('button[data-needselect="true"]').attr('disabled', 'disabled');
        } else {
          $row.parent().children('tr').removeClass('info');
          $row.addClass('info');

          $('#datamanagement nav').find('button[data-needselect="true"]').removeAttr('disabled');
        }
      },

      getStructure: function ($inputs) {
        var structure = [];

        $inputs.filter('[data-metatype]').each(function () {
          var $input = $(this);
          var metaType = $input.attr('data-metatype');

          var obj = {};
          if (metaType == 'DESCRIPTOR') {
            obj["descriptor"] = $input.attr('data-id');
          } else {
            obj["interval"] = metaType;
          }
          obj['column'] = $input.val();

          structure.push(obj);
        });

        return structure;
      },

      getEntries: function ($inputs) {
        var entries = [];

        $inputs.filter('[data-metatype]').each(function () {
          var $input = $(this);

          var obj = {
            id: $input.attr('data-id'),
            metatype: $input.attr('data-metatype'),
            value: $input.val()
          };
          entries.push(obj);
        });

        return entries;
      },

      initDriversAndUrl: function ($drivers, $url) {
        var drivers = ['com.mysql.jdbc.Driver', 'org.postgresql.Driver', 'COM.ibm.db2.jdbc.app.DB2Driver', 'com.microsoft.jdbc.sqlserver.SQLServerDriver',
          'oracle.jdbc.driver.OracleDriver', 'org.hsqldb.jdbcDriver', 'org.gjt.mm.mysql.Driver', 'net.meisen.dissertation.jdbc.TidaDriver'];
        var urls = ['jdbc:mysql://[host]:[port]/[db]', 'jdbc:postgresql://[host]:[port]/[db]', 'jdbc:db2://[host]:[port]/[db]', 'jdbc:sqlserver://[host]:[port];databaseName=[db];',
          'jdbc:oracle:thin:@[host]:[port]:[sid]', 'jdbc:hsqldb:hsql://[host]:[port]/[db]', 'jdbc:mysql://[host]:[port]/[db]', 'jdbc:tida://@[host]:[port]'];

        $drivers.typeahead({
          source: drivers, autoSelect: true, minLength: 0
        });

        $url.typeahead({
          source: urls, autoSelect: true, minLength: 0
        });
      }
    };
  });
define('net/meisen/dissertation/ui/app/page/analyze',[
        'jquery',
        'bootstrap3-typeahead',
        'net/meisen/dissertation/ui/app/model',
        'net/meisen/dissertation/ui/app/server/tidaAPI',
        'net/meisen/dissertation/ui/app/utilities',
        'net/meisen/dissertation/ui/app/page/modelmanager',
        'net/meisen/dissertation/ui/app/page/analysisquerymanager',
        'net/meisen/dissertation/ui/app/page/usermanager',
        'net/meisen/dissertation/ui/app/page/datamanager'
    ],
    function ($,
              typeahead,
              model,
              tidaAPI,
              util,
              modelmanager,
              analysisquerymanager,
              usermanager,
              datamanager) {

        var changePage = function (item) {
            var selector = item.attr('data-target');

            // show the correct page
            $('.container-fluid .main').addClass('hide');
            $(selector).removeClass('hide');

            // select the correct button in the nav
            $('.container-fluid li').removeClass('active');
            $('.container-fluid li a span.sr-only').remove();
            item.parent().addClass('active');
            item.append('<span class="sr-only">(current)</span>');

            // do some page dependent stuff
            if (selector == '#modelmanagement') {
                modelmanager.reloadModels($('#tableModels tbody'));
                loadModels();
            } else if (selector == '#usermanagement') {
                usermanager.reloadUsersAndRoles($('#tableUsers tbody'), $('#tableRoles tbody'));
            } else if (selector == '#datamanagement') {
                loadModels();
            }

            // keep the map
            model.map.set('analyze.subpage', selector);
        };

        var toggleQuery = function (val) {
            var $queryPanel = $('#queryPanel');
            var $toggleQuery = $('#toggleQuery');

            val = typeof(val) == 'boolean' ? val : $queryPanel.hasClass('hide');
            if (val) {
                $queryPanel.removeClass('hide');
                $queryPanel.find('textarea').focus();
                $toggleQuery.removeClass('btn-default').addClass('btn-primary');
                model.map.set('analyze.toggleQuery', true);
            } else {
                $queryPanel.addClass('hide');
                $toggleQuery.removeClass('btn-primary').addClass('btn-default');
                model.map.set('analyze.toggleQuery', false);
            }
        };

        // function to load the models
        var loadModels = function (val) {
            var $inputModelSearch = $('input.modelSearch');
            tidaAPI.getModels(model.serverSettings.getCurrent(), model.session.getCurrent(), function (status, data) {
                if (status) {
                    $inputModelSearch.typeahead('destroy');

                    var filteredData = [];
                    $.each(data, function (idx, val) {
                        if (val.loaded) {
                            filteredData.push(val.model);
                        }
                    });
                    filteredData.sort();

                    $inputModelSearch.typeahead({
                        source: filteredData, autoSelect: true, minLength: 0
                    });
                } else {
                    $inputModelSearch.attr('disabled', '');
                }
            });
        };

        return function () {
            util.appendLogout();
            util.appendLoading();

            /*
             * General handling, reset values
             */
            $('[data-toggle=offcanvas]').click(function () {
                $('.row-offcanvas').toggleClass('active');
            });

            // select the right menu
            var subpage = model.map.get('analyze.subpage', '#modelmanagement');
            changePage($('.nav a[data-target="' + subpage + '"]'));

            // toggle the query
            var toggle = model.map.get('analyze.toggleQuery', true);
            toggleQuery(toggle);

            // reset a query set
            var query = model.map.get('analyze.query', '');
            $('#queryInput').val(query);

            // add click functionality to the buttons in the menu
            $('.nav a[data-target]').click(function () {
                changePage($(this));
            });

            // load the models were needed
            loadModels();

            /*
             * Model Management
             */
            // add some features for modals
            $('#btnAddModel').submit(function (event) {

                // check the autoload value
                var autoload = $('#modelAutoload').is(':checked');

                // fire the upload
                modelmanager.uploadModel($('#tableModels tbody'), $('#modalAddModel form'), autoload);
                $('#modalAddModel').modal('hide');

                // stop the submit event from being processed
                event.preventDefault();
            });
            $('#btnDeleteModel').click(function () {
                modelmanager.deleteModel($('#tableModels tbody tr.info'));
                $('#modalDeleteModel').modal('hide');
            });
            $('#btnRefreshModels').click(function () {
                modelmanager.reloadModels($('#tableModels tbody'));
            });
            $('#btnLoadModel').click(function () {
                modelmanager.loadModel($('#tableModels tbody tr.info'));
            });
            $('#btnUnloadModel').click(function () {
                modelmanager.unloadModel($('#tableModels tbody tr.info'));
            });

            /*
             * Data Management
             */
            datamanager.initDriversAndUrl($('#inputDriver'), $('#inputJdbc'));

            var $btnLoadData = $('#btnLoadData');
            $btnLoadData.click(function () {
                datamanager.loadModel($('#inputDataSearch').val(), $('#tableData'));
            });
            var $inputDataSearch = $('#inputDataSearch');
            $inputDataSearch.change(function () {
                var $buttons = $('#datamanagement .navbar-header button[data-needselect!="true"]');
                if ($inputDataSearch.val() == '') {
                    $buttons.attr('disabled', '');
                } else {
                    $buttons.removeAttr('disabled');
                }
            });
            var $modalLoadFromDb = $('#modalLoadFromDb');
            $modalLoadFromDb.on('show.bs.modal', function () {
                datamanager.resetDbModal();
                datamanager.updateDbModal($('#inputDataSearch').val());
            });
            $('#btnLoadFromDb').click(function () {
                datamanager.loadDbData($('#inputDataSearch').val());
            });
            var $modalLoadFromCsv = $('#modalLoadFromCsv');
            $modalLoadFromCsv.on('show.bs.modal', function () {
                datamanager.resetCsvModal();
                datamanager.updateCsvModal($('#inputDataSearch').val());
            });
            $('#btnLoadFromCsv').click(function () {
                datamanager.loadCsvData($('#inputDataSearch').val());
            });
            var $modalLoadFromModel = $('#modalLoadFromModel');
            $modalLoadFromModel.on('show.bs.modal', function () {
                datamanager.resetModelModal();
                datamanager.updateModelModal($('#inputDataSearch').val());
            });
            $('#btnLoadFromModel').click(function () {
                datamanager.loadModelData($('#inputDataSearch').val());
            });
            var $modalLoadSingle = $('#modalLoadSingle');
            $modalLoadSingle.on('show.bs.modal', function () {
                datamanager.resetSingleModal();
                datamanager.updateSingleModal($('#inputDataSearch').val());
            });
            $('#btnLoadSingle').click(function () {
                datamanager.loadSingleRecord($('#inputDataSearch').val());
            });
            $('.modal[data-refresh="modeldata"]').on('hidden.bs.modal', function (e) {
                var $this = $(this);
                var refresh = $this.attr('data-dorefresh');

                // do the refreshing
                if (refresh == 'true') {
                    datamanager.loadModel($('#inputDataSearch').val(), $('#tableData'));
                }

                // remove the attribute
                $this.removeAttr('data-dorefresh');
            });
            $('#btnDeleteDataFromModel').click(function () {
                var $table = $('#tableData');
                var $row = $table.find('tr.info');

                if ($row != null) {
                    datamanager.deleteModelData($table, $row, $row.attr('data-model'), $row.attr('data-id'));
                }
            });

            /*
             * User Management
             */
            $('#btnRefreshUsersAndRoles').click(function () {
                usermanager.reloadUsersAndRoles($('#tableUsers tbody'), $('#tableRoles tbody'));
            });

            /*
             * Analytics
             */
            var $queryInput = $('#queryInput');
            $('#closeQuery').click(toggleQuery);
            $('#toggleQuery').click(toggleQuery);
            $('button[data-action="queryReset"]').click(function () {
                $queryInput.val('');
            });
            $queryInput.on('input', function () {
                model.map.set('analyze.query', $queryInput.val());
            });
            $('button[data-action="queryFire"]').click(function () {
                analysisquerymanager.showResult($queryInput.val());
            });
            analysisquerymanager.initGanttChartSettings($('#modalGanttChartSettings'), $('#stepGanttChartSettingsSelector'), $('#tableMappings'), $('#selectedGroupDescriptor'),
                $('#btnAcceptGanttChartSettings'), $('#btnRemoveGanttChartSettings'), $('#btnAddGroupDescriptor'), $('#btnAddMapping'), $('#btnOpenColorPicker'), $('#inputGroupDescriptor'), $('#inputGroupMapper'), function (settings) {
                    analysisquerymanager.showGanttChart($queryInput.val(), settings);
                });
            var $modalGanttChartSettings = $('#modalGanttChartSettings');
            $modalGanttChartSettings.on('show.bs.modal', function () {
                analysisquerymanager.resetGanttChartSettings($('#stepGanttChartSettingsSelector'), $('#btnAcceptGanttChartSettings'), $('#btnOpenColorPicker'), $('#tableMappings'), $('#selectedGroupDescriptor'));
            });
            $('#formGroupSelection').submit(function (event) {
                $('#inputGroupDescriptor').trigger('addGanttChartGroupDescriptor');
                return false;
            });
            $('#formMappings').submit(function (event) {
                $('#inputGroupMapper').trigger('addGanttChartMapping');
                return false;
            });

            // make sure the modals are resetted
            $('.modal').on('hidden.bs.modal', function () {
                var form = $(this).find('form')[0];
                if (typeof(form) != 'undefined') {
                    form.reset();
                }
            });
        };
    });
define('net/meisen/dissertation/ui/app/page/docs',['jquery', 'net/meisen/dissertation/ui/app/utilities'], function ($, util) {

  return function () {

    // check if we can logout, i.e. if a session is available
    util.setupNav($('.navbar'));

    // add the scrollspy to make the menu on the left nicer
    $('body').scrollspy({target: '#navbarContent'});

    // add the license
    util.createLicense($('body'));
  };
});
define('net/meisen/dissertation/ui/app/page/download',['jquery', 'net/meisen/dissertation/ui/app/utilities'], function ($, util) {

  return function () {

    $('#btnDownload').click(function() {
      var url = (util.isWebsite() ? '' : 'http://tida.meisen.net/') + 'downloads/tidais-TRUNK-SNAPSHOT.zip';
      window.location.href = url;
    });

    util.createLicense($('body'));
  };
});
define('net/meisen/dissertation/ui/app/page/error',['jquery'], function ($) {

  return function () {

  };
});
requirejs.config({

    // define the baseUrl defined by the processenabler
    baseUrl: 'scripts',

    // map: {
        //'*': {
            //'jquery': 'jquery-private',
        //},
        //'jquery-private': {'jquery': 'jquery'}
    // },

    // shim amplify it's not AMD conform
    shim: {
        'amplify': {
            deps: ['jquery'],
            exports: 'amplify'
        },
        'bootstrap': {
            deps: ['jquery'],
            exports: 'bootstrap'
        },
        'bootstrap3-typeahead': {
            deps: ['jquery', 'bootstrap'],
            exports: 'typeahead'
        },
        'bootstrap-colorpicker': {
            deps: ['jquery', 'bootstrap'],
            exports: 'bootstrap-colorpicker'
        },
        'highcharts': {
            deps: ['jquery'],
            exports: 'highcharts'
        }
    }
});

// get jquery and all available pages
require([
    'jquery',
    'bootstrap',
    'net/meisen/dissertation/ui/app/model',
    'net/meisen/dissertation/ui/app/page/index',
    'net/meisen/dissertation/ui/app/page/login',
    'net/meisen/dissertation/ui/app/page/logout',
    'net/meisen/dissertation/ui/app/page/main',
    'net/meisen/dissertation/ui/app/page/analyze',
    'net/meisen/dissertation/ui/app/page/docs',
    'net/meisen/dissertation/ui/app/page/download',
    'net/meisen/dissertation/ui/app/page/error'
], function ($,
             bootstrap,
             model,
             index,
             login,
             logout,
             main,
             analyze,
             docs,
             download,
             error) {

    // make sure tests will work and we don't redirect
    if (window.location.href.indexOf('runTests', this.length - 'runTests'.length) !== -1) {
        return;
    }

    // get the current page
    var $body = $('body');
    var type = $body.attr('data-type');

    // make sure we have values
    type = typeof type !== 'string' || type.trim() == '' || type.replace(/session|global/g, '') ? 'session' : type;

    // check if we have a valid session
    if (type == 'session') {
        var session = model.session.getCurrent();

        // validate the session, if not valid redirect to login
        if (!$.isPlainObject(session) || session == null || typeof(session) == 'undefined') {

            // remove the session information
            model.clean();
            window.location.replace('login.html');

            return;
        }
    }

    // require the function of the page, validate it, and execute
    var page = $body.attr('data-page');
    if (model.page.validate(page)) {
        var funcPage = null;
        try {
            funcPage = eval(page);
        } catch (e) {
            funcPage = null;
        }

        if (funcPage != null && $.isFunction(funcPage)) {
            model.page.update(page);
            funcPage();
        } else {
            window.location.replace('error.html');
        }
    } else {
        window.location.replace('error.html');
    }

    // show the page in the end
    $body.css('visibility', 'visible');
});
define("net/meisen/dissertation/ui/app/App", function(){});

}());