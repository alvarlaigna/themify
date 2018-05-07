"use strict";
var __assign = (this && this.__assign) || Object.assign || function(t) {
    for (var s, i = 1, n = arguments.length; i < n; i++) {
        s = arguments[i];
        for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
            t[p] = s[p];
    }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
var json_util_1 = require("./helpers/json.util");
var postcss = require('postcss');
var fs = require('fs-extra');
var hexToRgba = require('hex-to-rgba');
var THEMIFY = 'themify';
var JSToSass = require('./helpers/js-sass');
var _cleanCSS = require('clean-css');
var cleanCSS = new _cleanCSS();
var defaultOptions = {
    createVars: true,
    palette: {},
    classPrefix: '',
    screwIE11: true,
    fallback: {
        cssPath: null,
        dynamicPath: null
    }
};
/** supported color variations */
var ColorVariation = {
    DARK: 'dark',
    LIGHT: 'light'
};
function buildOptions(options) {
    if (!options) {
        throw new Error("options is required.");
    }
    // make sure we have a palette
    if (!options.palette) {
        throw new Error("The 'palette' option is required.");
    }
    return __assign({}, defaultOptions, options);
}
/**
 *
 * @param {string} filePath
 * @param {string} output
 * @returns {Promise<any>}
 */
function writeToFile(filePath, output) {
    return fs.outputFile(filePath, output);
}
/**
 * Get the rgba as 88, 88, 33 instead rgba(88, 88, 33, 1)
 * @param value
 */
function getRgbaNumbers(value) {
    return hexToRgba(value)
        .replace('rgba(', '')
        .replace(', 1)', '');
}
/** Define the default variation */
var defaultVariation = ColorVariation.LIGHT;
/** An array of variation values  */
var variationValues = Object.values(ColorVariation);
/** An array of all non-default variations */
var nonDefaultVariations = variationValues.filter(function (v) { return v !== defaultVariation; });
function themify(options) {
    /** Regex to get the value inside the themify parenthesis */
    var themifyRegExp = /themify\(([^)]+)\)/gi;
    options = buildOptions(options);
    return function (root) {
        // process fallback CSS, without mutating the rules
        if (options.screwIE11 === false) {
            processFallbackRules(root);
        }
        // mutate the existing rules
        processRules(root);
    };
    /**
     * @example themify({"light": ["primary-0", 0.5], "dark": "primary-700"})
     * @example themify({"light": "primary-0", "dark": "primary-700"})
     * @example linear-gradient(themify({"color": "primary-200", "opacity": "1"}), themify({"color": "primary-300", "opacity": "1"}))
     * @example themify({"light": ["primary-100", "1"], "dark": ["primary-100", "1"]})
     * @example 1px solid themify({"light": ["primary-200", "1"], "dark": ["primary-200", "1"]})
     */
    function getThemifyValue(propertyValue, execMode) {
        /** Remove the start and end ticks **/
        propertyValue = propertyValue.replace(/'/g, '');
        var colorVariations = {};
        function normalize(value, variationName) {
            var parsedValue;
            try {
                parsedValue = JSON.parse(value);
            }
            catch (ex) {
                throw new Error("fail to parse the following expression: " + value + ".");
            }
            var currentValue = parsedValue[variationName];
            /** For example: background-color: themify((light: primary-100)); */
            if (!currentValue) {
                throw new Error(value + " has one variation.");
            }
            // convert to array
            if (!Array.isArray(currentValue)) {
                // color, alpha
                parsedValue[variationName] = [currentValue, 1];
            }
            else if (!currentValue.length || !currentValue[0]) {
                throw new Error('Oops. Received an empty color!');
            }
            if (options.palette)
                return parsedValue[variationName];
        }
        // iterate through all variations
        variationValues.forEach(function (variationName) {
            // replace all 'themify' tokens with the right string
            colorVariations[variationName] = propertyValue.replace(themifyRegExp, function (occurrence, value) {
                // parse and normalize the color
                var parsedColor = normalize(value, variationName);
                // convert it to the right format
                return translateColor(parsedColor, variationName, execMode);
            });
        });
        return colorVariations;
    }
    /**
     * Get the underline color, according to the execution mode
     * @param colorArr two sized array with the color and the alpha
     * @param variationName the name of the variation. e.g. light / dark
     * @param execMode
     */
    function translateColor(colorArr, variationName, execMode) {
        var colorVar = colorArr[0], alpha = colorArr[1];
        // returns the real color representation
        var underlineColor = options.palette[variationName][colorVar];
        if (!underlineColor) {
            // variable is not mandatory in non-default variations
            if (variationName !== defaultVariation) {
                return null;
            }
            throw new Error("The variable name '" + colorVar + "' doesn't exists in your palette.");
        }
        switch (execMode) {
            case "CSS_COLOR" /* CSS_COLOR */:
                // with default alpha - just returns the color
                if (alpha === '1') {
                    return underlineColor;
                }
                // with custom alpha, convert it to rgba
                var rgbaColorArr = getRgbaNumbers(underlineColor);
                return "rgba(" + rgbaColorArr + ", " + alpha + ")";
            case "DYNAMIC_EXPRESSION" /* DYNAMIC_EXPRESSION */:
                // returns it in a unique pattern, so it will be easy to replace it in runtime
                return "%[" + variationName + ", " + colorVar + ", " + alpha + "]%";
            default:
                // return an rgba with the CSS variable name
                return "rgba(var(--" + colorVar + "), " + alpha + ")";
        }
    }
    /**
     * Walk through all rules, and replace each themify occurrence with the corresponding CSS variable.
     * @example background-color: themify(primary-300, 0.5) => background-color: rgba(var(--primary-300),0.6)
     * @param root
     */
    function processRules(root) {
        root.walkRules(function (rule) {
            var aggragatedSelectorsMap = {};
            var aggragatedSelectors = [];
            var createdRules = [];
            var variationRules = (_a = {},
                _a[defaultVariation] = rule,
                _a);
            rule.walkDecls(function (decl) {
                var propertyValue = decl.value;
                if (!hasThemify(propertyValue))
                    return;
                var property = decl.prop;
                var variationValueMap = getThemifyValue(propertyValue, "CSS_VAR" /* CSS_VAR */);
                var defaultVariationValue = variationValueMap[defaultVariation];
                decl.value = defaultVariationValue;
                // indicate if we have a global rule, that cannot be nested
                var isGlobalRule = rule.parent && rule.parent.type === 'atrule' && /keyframes/.test(rule.parent.name);
                // don't create extra CSS for global rules
                if (isGlobalRule) {
                    return;
                }
                // create a new declaration and append it to each rule
                nonDefaultVariations.forEach(function (variationName) {
                    var currentValue = variationValueMap[variationName];
                    // variable for non-default variation is optional
                    if (!currentValue || currentValue === 'null') {
                        return;
                    }
                    // when the declaration is the same as the default variation,
                    // we just need to concatenate our selector to the default rule
                    if (currentValue === defaultVariationValue) {
                        var selector = getSelectorName(rule, variationName);
                        // append the selector once
                        if (!aggragatedSelectorsMap[variationName]) {
                            aggragatedSelectorsMap[variationName] = true;
                            aggragatedSelectors.push(selector);
                        }
                    }
                    else {
                        // creating the rule for the first time
                        if (!variationRules[variationName]) {
                            var clonedRule = createRuleWithVariation(rule, variationName);
                            variationRules[variationName] = clonedRule;
                            // append the new rule to the array, so we can append it later
                            createdRules.push(clonedRule);
                        }
                        var variationDecl = createDecl(property, variationValueMap[variationName]);
                        variationRules[variationName].append(variationDecl);
                    }
                });
            });
            if (aggragatedSelectors.length) {
                rule.selectors = rule.selectors.concat(aggragatedSelectors);
            }
            // append each created rule
            if (createdRules.length) {
                createdRules.forEach(function (r) { return root.append(r); });
            }
            var _a;
        });
    }
    /**
     * Walk through all rules, and generate a CSS fallback for legacy browsers.
     * Two files shall be created for full compatibility:
     *  1. A CSS file, contains all the rules with the original color representation.
     *  2. A JSON with the themify rules, in the following form:
     *      themify(primary-100, 0.5) => %[light,primary-100,0.5)%
     * @param root
     */
    function processFallbackRules(root) {
        // an output for each execution mode
        var output = (_a = {},
            _a["CSS_COLOR" /* CSS_COLOR */] = [],
            _a["DYNAMIC_EXPRESSION" /* DYNAMIC_EXPRESSION */] = {},
            _a);
        // initialize DYNAMIC_EXPRESSION with all existing variations
        variationValues.forEach(function (variation) { return (output["DYNAMIC_EXPRESSION" /* DYNAMIC_EXPRESSION */][variation] = []); });
        // define which modes need to be processed
        var execModes = ["CSS_COLOR" /* CSS_COLOR */, "DYNAMIC_EXPRESSION" /* DYNAMIC_EXPRESSION */];
        root.walkRules(function (rule) {
            var ruleModeMap = {};
            rule.walkDecls(function (decl) {
                var propertyValue = decl.value;
                if (!hasThemify(propertyValue))
                    return;
                var property = decl.prop;
                execModes.forEach(function (mode) {
                    // lazily creating a new rule for each variation, for the specific mode
                    if (!ruleModeMap.hasOwnProperty(mode)) {
                        ruleModeMap[mode] = {};
                        variationValues.forEach(function (variationName) {
                            var newRule;
                            if (variationName === defaultVariation) {
                                newRule = cloneEmptyRule(rule);
                            }
                            else {
                                newRule = createRuleWithVariation(rule, variationName);
                            }
                            // push the new rule into the right place,
                            // so we can write them later to external file
                            var rulesOutput = output[mode];
                            if (!Array.isArray(rulesOutput)) {
                                rulesOutput = rulesOutput[variationName];
                            }
                            rulesOutput.push(newRule);
                            ruleModeMap[mode][variationName] = newRule;
                        });
                    }
                    var colorMap = getThemifyValue(propertyValue, mode);
                    // create and append a new declaration
                    variationValues.forEach(function (variationName) {
                        var underlineColor = colorMap[variationName];
                        if (underlineColor && underlineColor !== 'null') {
                            var newDecl = createDecl(property, colorMap[variationName]);
                            ruleModeMap[mode][variationName].append(newDecl);
                        }
                    });
                });
            });
        });
        // write the CSS & JSON to external files
        if (output["CSS_COLOR" /* CSS_COLOR */].length) {
            // write CSS fallback;
            var fallbackCss = output["CSS_COLOR" /* CSS_COLOR */].join('');
            writeToFile(options.fallback.cssPath, fallbackCss);
            // creating a JSON for the dynamic expressions
            var jsonOutput_1 = {};
            variationValues.forEach(function (variationName) {
                jsonOutput_1[variationName] = output["DYNAMIC_EXPRESSION" /* DYNAMIC_EXPRESSION */][variationName] || [];
                jsonOutput_1[variationName] = json_util_1.minifyJSON(jsonOutput_1[variationName].join(''));
                // minify the CSS output
                jsonOutput_1[variationName] = cleanCSS.minify(jsonOutput_1[variationName]).styles;
            });
            // stringify and save
            var dynamicCss = JSON.stringify(jsonOutput_1);
            writeToFile(options.fallback.dynamicPath, dynamicCss);
        }
        var _a;
    }
    function createDecl(prop, value) {
        return postcss.decl({ prop: prop, value: value });
    }
    /**
     * check if there's a themify keyword in this declaration
     * @param propertyValue
     */
    function hasThemify(propertyValue) {
        return propertyValue.indexOf(THEMIFY) > -1;
    }
    /**
     * Create a new rule for the given variation, out of the original rule
     * @param rule
     * @param variationName
     */
    function createRuleWithVariation(rule, variationName) {
        var selector = getSelectorName(rule, variationName);
        return postcss.rule({ selector: selector });
    }
    /**
     * Get a selector name for the given rule and variation
     * @param rule
     * @param variationName
     */
    function getSelectorName(rule, variationName) {
        var selectorPrefix = "." + (options.classPrefix || '') + variationName;
        return rule.selectors
            .map(function (selector) {
            return selectorPrefix + " " + selector;
        })
            .join(',');
    }
    function cloneEmptyRule(rule) {
        var clonedRule = rule.clone();
        // remove all the declaration from this rule
        clonedRule.removeAll();
        return clonedRule;
    }
}
/**
 * Generating a SASS definition file with the palette map and the CSS variables.
 * This file should be injected into your bundle.
 */
function init(options) {
    options = buildOptions(options);
    return function (root) {
        var palette = options.palette;
        var css = generateVars(palette, options.classPrefix);
        var parsedCss = postcss.parse(css);
        root.prepend(parsedCss);
    };
    /**
     * This function responsible for creating the CSS variable.
     *
     *  The output should look like the following:
     *
     *  .light {
         --primary-700: 255, 255, 255;
         --primary-600: 248, 248, 249;
         --primary-500: 242, 242, 244;
   *   }
     *
     *  .dark {
         --primary-700: 255, 255, 255;
         --primary-600: 248, 248, 249;
         --primary-500: 242, 242, 244;
   *   }
     *
     */
    function generateVars(palette, prefix) {
        var cssOutput = '';
        prefix = prefix || '';
        // iterate through the different variations
        Object.keys(palette).forEach(function (variationName) {
            var selector = variationName === ColorVariation.LIGHT ? ':root' : "." + prefix + variationName;
            var variationColors = palette[variationName];
            // make sure we got colors for this variation
            if (!variationColors) {
                throw new Error("Expected map of colors for the variation name " + variationName);
            }
            var variationKeys = Object.keys(variationColors);
            // generate CSS variables
            var vars = variationKeys
                .map(function (varName) {
                return "--" + varName + ": " + getRgbaNumbers(variationColors[varName]) + ";";
            })
                .join(' ');
            // concatenate the variables to the output
            var output = selector + " {" + vars + "}";
            cssOutput = cssOutput + " " + output;
        });
        // generate the $palette variable
        cssOutput += "$palette: " + JSToSass(palette) + ";";
        return cssOutput;
    }
}
module.exports = {
    initThemify: postcss.plugin('datoThemes', init),
    themify: postcss.plugin('datoThemes', themify)
};
