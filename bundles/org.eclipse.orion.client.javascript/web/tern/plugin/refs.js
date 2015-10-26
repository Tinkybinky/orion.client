/*******************************************************************************
 * @license
 * Copyright (c) 2015 IBM Corporation and others.
 * All rights reserved. This program and the accompanying materials are made 
 * available under the terms of the Eclipse Public License v1.0 
 * (http://www.eclipse.org/legal/epl-v10.html), and the Eclipse Distribution 
 * License v1.0 (http://www.eclipse.org/org/documents/edl-v10.html). 
 *
 * Contributors:
 *     IBM Corporation - initial API and implementation
 *******************************************************************************/
/*eslint-env node, amd*/
/*globals infer tern walk*/
define([
	"../lib/infer", 
	"../lib/tern", 
	"acorn/dist/walk",
	"javascript/finder"
],/* @callback */ function(infer, tern, walk, finder) {
	
	var pending = Object.create(null);
	
	tern.registerPlugin('refs', /* @callback */ function(server, options) { //$NON-NLS-1$
		return {};
	});
		
	tern.defineQueryType('checkRef', { //$NON-NLS-1$
		/**
		 * @callback
		 */
		run: function run(server, query) {
		},
		
		/**
		 * @callback
		 */
		runAsync: function runAsync(server, query, serverFile, f) {
			var file = tern.resolveFile(server, server.fileMap, query.file);
			if(!file) {
				server.addFile(query.file);
				pending[query.file] = {
					callback: f,
					query: query
				};
				server.on("afterLoad", function(file) { //$NON-NLS-1$
					if(file && file.name) {
						var p = pending[file.name];
						if(p) {
							delete pending[file.name];
							doCheck(p.query, file, server, p.callback);
						}	
					}
				}.bind(server));
			} else {
				doCheck(query, file, server, f);
			}
		}
	});
	
	function doCheck(query, file, server, f) {
		try {
			var comment = finder.findComment(query.end, file.ast), result;
			if(comment) {
				result = {
			    	guess: false,
			        type: undefined,
			        name: undefined,
			        category: comment.type === 'Block' ? 'blockcomments': 'linecomments' //$NON-NLS-1$ //$NON-NLS-2$
			    };
			} else {
				var expr = tern.findExpr(file, query), exprName, type, exprType;
				try {
				    type = tern.findExprType(server, query, file, expr);
				    exprType = type;
				    if (query.preferFunction) {
						type = type.getFunctionType() || type.getType();
					} else {
						type = type.getType();
					}
				    if (expr) {
						if (expr.node.type === "Identifier") {
				        	exprName = expr.node.name;
			        	} else if (expr.node.type === "MemberExpression" && !expr.node.computed) {
				        	exprName = expr.node.property.name;
			        	}
				    }
			    }
				catch(er) {
					//do nothing tag the result later and do a static check
				}
			    result = {
			    	guess: infer.didGuess(),
			        type: infer.toString(exprType),
			        name: type && type.name,
			        exprName: exprName
			    };
			    categorize(query, file, result);
			    if (type) {
			    	tern.storeTypeDocs(query, type, result);
		    	} else {
		    		staticCheck(query, file, result);
		    	}
			    if (!result.doc && exprType && exprType.doc) {
			    	result.doc = tern.parseDoc(query, exprType.doc);
				}
		    }
		    f(null, result);
	    }
	    catch(err) {
		    if (server.options.debug && err.name !== "TernError") {
				console.error(err.stack);
			}
	        f(err);
	    }
	}
	
	/**
	 * @description Tags the match with the category is belongs to
	 * @function
	 * @private
	 * @param {Object} node The AST node
	 * @param {Object} result The result
	 */
	function categorize(query, file, result) {
		var node = finder.findNode(query.end, file.ast, {parents:true});
		if(node) {
			if(node.type === 'Identifier') {
				var p = node.parents.pop();
				p.parents = node.parents;
				node = p;
			} 
			if(node.type !== 'RecoveredNode') {
				switch(node.type) {
					case 'FunctionDeclaration':
					case 'FunctionExpression': {
						result.category = 'funcdecls'; //$NON-NLS-1$
						break;
					}
					case 'Property': {
						if(encloses(query.end, node.key)) {
							result.category = 'propwrite'; //$NON-NLS-1$
						} else if(encloses(query.end, node.value)) {
							if(node.value.type === 'FunctionExpression') {
								result.category = 'funcdecls'; //$NON-NLS-1$
							} else if(node.value.type === 'Identifier') {
								result.category = 'varaccess'; //$NON-NLS-1$
							} else {
								result.category = 'propwrite'; //$NON-NLS-1$
							}
						}
						break;
					}
					case 'CallExpression': {
						if(encloses(query.end, node.callee)) {
							result.category = 'funccalls'; //$NON-NLS-1$
						} 
						if(node.arguments.length > 0) {
							for(var i = 0, len = node.arguments.length; i < len; i++) {
								var param = node.arguments[i];
								if(encloses(query.end, param))	{
									if(param.type === 'Identifier') {
										result.category = 'varaccess'; //$NON-NLS-1$
									} else if(param.type === 'MemberExpression') {
										result.category = 'propaccess'; //$NON-NLS-1$
									}
								}
							}
						}
						break;
					}
					case 'AssignmentExpression': {
						if(encloses(query.end, node.left)) {
							//on the left, write
							if(node.left.type === 'Identifier') {
								result.category = 'varwrite'; //$NON-NLS-1$
							} else {
								result.category = 'propwrite'; //$NON-NLS-1$
							}
						} else if(encloses(query.end, node.right)) {
							if(node.right.type === 'Identifier') {
								result.category = 'varaccess'; //$NON-NLS-1$
							} else if(node.right.type === 'MemberExpression') {
								result.category = 'propaccess'; //$NON-NLS-1$
							} 
						}
						break;
					}
					case 'VariableDeclarator': {
						if(encloses(query.end, node.id)) {
							result.category = 'varwrite'; //$NON-NLS-1$
						} else if(encloses(query.end, node.init)) {
							result.category = 'varaccess';						 //$NON-NLS-1$
						}
						break;
					}
					case 'Literal': {
						if(node.regex) {
							result.category = 'regex'; //$NON-NLS-1$
						} else if(typeof(node.value) === "string") {
							result.category = 'strings'; //$NON-NLS-1$
						}
						break;
					}
					case 'MemberExpression': {
						//TODO we need the first non-member expression parent from Tern to know how the expression is being used
						//LHS vs RHS expressions
						var prop;
						while(node.type === 'MemberExpression') {
							prop = node.property;
							p = node.parents.pop();
							p.parents = node.parents;
							node = p;
						}
						if(node && (node.type === 'CallExpression' || node.type === 'NewExpression') && encloses(query.end, prop)) {
							result.category = 'funccalls'; //$NON-NLS-1$
						} else if(node && node.type === 'AssignmentExpression') {
							if(encloses(query.end, node.left)) {
								if(encloses(query.end, prop)) {
									result.category = 'propwrite'; //$NON-NLS-1$
								} else {
									result.category = 'propaccess'; //$NON-NLS-1$
								}
							} else {
								result.category = 'propaccess'; //$NON-NLS-1$
							}
						} else {
							result.category = 'propaccess'; //$NON-NLS-1$
						}
						break;
					}
					case 'UpdateExpression': {
						if(node.argument.type === 'Identifier') {
							result.category = 'varaccess'; //$NON-NLS-1$
						} else if(node.argument.type === 'MemberExpression') {
							result.category = 'propaccess'; //$NON-NLS-1$
						}
						break;
					}
					case 'BinaryExpression': {
						if(node.left.type === 'Identifier' && encloses(query.end, node.left)) {
							result.category = 'varaccess'; //$NON-NLS-1$
						} else if(node.right.type === 'Identifier' && encloses(query.end, node.right)) {
							result.category = 'varaccess'; //$NON-NLS-1$
						}
						break;
					}
					case 'BreakStatement':
					case 'ContinueStatement':
					case 'IfStatement': 
					case 'DoWhileStatement':
					case 'ForInStatement':
					case 'ForStatement':
					case 'SwitchStatement':
					case 'SwitchCase':
					case 'WithStatement': 
					case 'WhileStatement': {
						result.category = 'varaccess'; //$NON-NLS-1$
						break;
					}
					case 'LetStatement':
					case 'LabeledStatement': {
						result.category = 'varwrite'; //$NON-NLS-1$
						break;
					}
					case 'Block': {
						result.category = 'blockcomments'; //$NON-NLS-1$
						break;
					}
					case 'Line': {
						result.category = 'linecomments'; //$NON-NLS-1$
						break;
					}
				}
			}
		}
		if(!result.category) {
			result.category = 'partial'; //$NON-NLS-1$
		}
	}
	
	function encloses(offset, node) {
		return node && (node.range[0] <= offset && offset <= node.range[1]);
	}
	
	function staticCheck(query, file, result) {
		var node = finder.findNode(query.end, file.ast, {parents: true});
		if(node) {
			checkNode(query, node, result);
		} else {
			result.staticCheck = {
				confidence: -1
			};
		}
	}
		
	function checkNode(query, node, result) {
		switch(node.type) {
			case 'FunctionDeclaration':
			case 'FucntionExpression':
			case 'VariableDeclarator': 
			case 'Literal': {
				//a re-decl cannot be a reference
				result.staticCheck = {
					confidence: -1
				};
				break;
			}
			case 'Identifier': {
				if(Array.isArray(node.parents)) {
					var p = node.parents.slice(node.parents.length-1)[0];
					checkNode(query, p, result);
				} else {
					result.staticCheck = {
						confidence: 25
					};
				}
				break;
			}
			case 'AssignmentExpression': {
				if(node.left.type === 'Identifier' && node.left.name === query.origin.type.exprName) {
					result.staticCheck = {
						confidence: 25
					};
				} else if(node.right.type === 'Identifier' && node.right.name === query.origin.type.exprName) {
					result.staticCheck = {
						confidence: 25
					};
				} else {
					//TODO catch all
					result.staticCheck = {
						confidence: 5
					};
				}
				break;
			}
			case 'MemberExpression': {
				//if part of the expression, maybe relevant
				result.staticCheck = {
					confidence: 10
				};
				break;
			}
			case 'CallExpression': {
				if(node.callee.name === query.origin.type.exprName) {
					if(query.origin.type.type === 'fn()') {
						result.staticCheck = {
							confidence: 25
						};
					} else {
						result.staticCheck = {
							confidence: -1
						};
					}
				}
				for(var i = 0, l = node.arguments.length; i < l; i++) {
					var arg = node.arguments[i];
					if(arg.type === 'Identifier') {
						if(query.origin.type.type === 'fn()') {
							//orig type is function, this is not relevant
							result.staticCheck = {
								confidence: -1
							};
						} else {
							//with no type infos we have no idea if this is the same one
							result.staticCheck = {
								confidence: 40
							};
						}
					} else if(arg.type === 'FunctionExpression') {
						if(arg.id === query.origin.type.exprName) {
							//redecl, not relevant
							result.staticCheck = {
								confidence: -1
							};
						}
					}
				}
				break;
			}
			default: {
				result.staticCheck = {
					confidence: 0
				};
			}
		}
	}
}); 