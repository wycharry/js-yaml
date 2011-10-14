JS.require('JS.Class');
JS.require('JS.Hash');

var errors = require('./errors'),
    nodes = require('./nodes'),
    types = require('./types');


var ConstructorError = exports.ConstructorError = new JS.Class('ConstructorError', errors.MarkedYAMLError);


var BOOL_VALUES = {
  'yes':      true,
  'no':       false,
  'true':     true,
  'false':    false,
  'on':       true,
  'off':      false,
}


var BaseConstructor = exports.BaseConstructor = new JS.Class('BaseConstructor', {
  extend: {
    yamlConstructors: new JS.Hash(),
    addConstructor: function (tag, constructor) {
      this.klass.yamlConstructors.store(tag, constructor);
    }
  },

  initialize: function () {
    this.constructedObjects = new JS.Hash();
    this.recursiveObjects = new JS.Hash();
    this.stateGenerators = [];
    this.deepConstruct = false;
  },

  checkData: function () {
    return this.checkNode();
  },

  getData: function () {
    if (this.checkNode()) {
      return this.constructDocument(this.getNode());
    }
  },

  getSingleData: function () {
    var node = this.getSingleNode();
    if (null !== node) {
      return this.constructDocument(node);
    }
    return null;
  },

  constructDocument: function (node) {
    var data = this.constructObject(node),
        state_generators = this.stateGenerators;

    this.stateGenerators = [];

    state_generators.forEach(function (generator) {
      generator.forEach(function (dummy) {
        // do nothing. everything was done when element was popped out.
      });
    });

    this.constructedObjects = {};
    this.recursiveObjects = {};
    this.deepConstruct = false;

    return data;
  },

  constructObject: function (node, deep) {
    var old_deep, constructor;

    if (this.constructedObjects.hasKey(node)) {
      return this.constructedObjects.get(node);
    }

    if (!!deep) {
      old_deep = this.deepConstruct;
      this.deepConstruct = true;
    }

    if (this.recursiveObjects.hasKey(node)) {
      throw new ConstructorError(null, null,
                  "found unconstructable recursive node",
                  node.startMark);
    }

    this.recursiveObjects.store(node, null);

    constructor = this.klass.yamlConstructors.get(node.tag);
    data = constructor.call(this, node);

    if (data.isA(types.Generator)) {
      generator = data;
      data = generator.next();
      if (this.deepConstruct) {
        generator.forEach(function (dummy) {
          // do nothing
        });
      }
    }

    this.constructedObjects.store(node, data)

    if (deep) {
      this.deepConstruct = old_deep;
    }

    return data
  },

  constructScalar: function (node) {
    if (!node.isA(nodes.ScalarNode)) {
      throw new ConstructorError(null, null,
                  "expected a scalar node, but found " + node.id,
                  node.startMark);
    }

    return node.value;
  },

  constructSequence: function (node, deep) {
    if (!node.isA(nodes.SequenceNode)) {
      throw new ConstructorError(null, null,
                  "expected a sequence node, but found " + node.id,
                  node.startMark);
    }

    return node.value.map(function (child) {
      return this.constructObject(child, deep);
    }, this);
  },

  constructMapping: function (node, deep) {
    var mapping;

    if (!node.isA(nodes.MappingNode)) {
      throw new ConstructorError(null, null,
                  "expected a mapping node, but found " + node.id,
                  node.startMark);
    }

    mapping = new JS.Hash();
    node.forEachPair(function (key_node, value_node) {
      var key, value;
      
      key = this.constructObject(key_node, deep);
      // TODO: Replace with interface test???
      if (!node.isA(types.Hashable)) {
        throw new ConstructorError("while constructing a mapping", node.startMark,
                    "found unhashable key", node.startMark);
      }
      value = this.constructObject(value_node, deep);
      mapping.store(key, value);
    }, this);
    return mapping;
  },

  constructPairs: function (node, deep) {
    var pairs;

    if (!node.isA(nodes.MappingNode)) {
      throw new ConstructorError(null, null,
                  "expected a mapping node, but found " + node.id,
                  node.startMark);
    }

    pairs = [];
    node.forEachPair(function (key_node, value_node) {
      var key, value;
      key = this.constructObject(key_node, deep);
      value = this.constructObject(value_node, deep);
      pairs.store(key, value);
    }, this);
    return pairs;
  }
});


var SafeConstructor = exports.SafeConstructor = new JS.Class('SafeConstructor', BaseConstructor, {
  constructScalar: function (node) {
    var result;

    if (!node.isA(nodes.MappingNode)) {
      node.value.forEachPair(function (key_node, value_node) {
        if ('tag:yaml.org,2002:value' == key_node.tag) {
          result = this.constructScalar(value_node);
        }
      });

      if (undefined !== result) {
        return result;
      }
    }

    return this.callSuper(node);
  },

  flattenMapping: function (node) {
    var merge = [], index = 0;

    while (index < node.value.length) {
        // TODO Implement this crazy logic
    }

    if (merge.length) {
      node.value = merge + node.value;
    }
  },

  constructMapping: function (node, deep) {
    if (node.isA(nodes.MappingNode)) {
      this.flattenMapping(node);
    }
    return this.callSuper(node);
  },

  constructYamlNull: function (node) {
    this.constructScalar(node);
    return null;
  },

  constructYamlBool: function (node) {
    var value = this.constructScalar(node);
    return BOOL_VALUES[value.toLowerCase()];
  },

  constructYamlInt: function (node) {
    var value = this.constructScalar(node).replace('_', ''),
        sign = ('-' == value[0]) ? -1 : 1,
        base, digits;

    if (/[-+]/.test(value[0])) {
      value = value.slice(1);
    }

    if ('0' == value) {
      return 0;
    } else if (/^0b/.test(value)) {
      return sign * parseInt(value, 2);
    } else if (/^0x/.test(value)) {
      return sign * parseInt(value, 16);
    } else if (/^0/.test(value)) {
      return sign * parseInt(value, 8);
    } else if (/:/.test(value)) {
      value.split(':').forEach(function (v) {
        digits.unshift(parseInt(v));
      });
      value = 0;
      base = 1;
      digits.forEach(function (d) {
        value += d * base;
        base *= 60;
      });
      return sign * value;
    } else {
      return sign * parseInt(value);
    }
  },

  constructYamlFloat: function (node) {
    var value = this.constructScalar(node).replace('_', ''),
        sign = ('-' == value[0]) ? -1 : 1,
        base, digits;

    if (/[-+]/.test(value[0])) {
      value = value.slice(1);
    }

    if ('.inf' == value) {
      return (1 == sign) ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    } else if ('.nan' == value) {
      return NaN;
    } else if (/:/.test(value)) {
      value.split(':').forEach(function (v) {
        digits.unshift(parseFloat(v));
      });
      value = 0.0;
      base = 1;
      digits.forEach(function (d) {
        value += d * base;
        base *= 60;
      });
      return sign * value;
    } else {
      return sign * parseFloat(value);
    }
  },

  constructYamlBinary: function (node) {
    return "Not Implemented Yet";
  },

  constructYamlTimestamp: function (node) {
    return "Not Implemented Yet";
  },


  constructYamlOmap: function (node) {
    return "Not Implemented Yet";
  },


  constructYamlPairs: function (node) {
    return "Not Implemented Yet";
  },


  constructYamlSet: function (node) {
    return "Not Implemented Yet";
  },


  constructYamlStr: function (node) {
    return "Not Implemented Yet";
  },


  constructYamlSeq: function (node) {
    return "Not Implemented Yet";
  },


  constructYamlMap: function (node) {
    return "Not Implemented Yet";
  },


  constructUndefined: function (node) {
    return "Not Implemented Yet";
  }
});


SafeConstructor.addConstructor(
    'tag:yaml.org,2002:null',
    SafeConstructor.instanceMethod('constructYamlNull'));

SafeConstructor.addConstructor(
    'tag:yaml.org,2002:bool',
    SafeConstructor.instanceMethod('constructYamlBool'));

SafeConstructor.addConstructor(
    'tag:yaml.org,2002:int',
    SafeConstructor.instanceMethod('constructYamlInt'));

SafeConstructor.addConstructor(
    'tag:yaml.org,2002:float',
    SafeConstructor.instanceMethod('constructYamlFloat'));

SafeConstructor.addConstructor(
    'tag:yaml.org,2002:binary',
    SafeConstructor.instanceMethod('constructYamlBinary'));

SafeConstructor.addConstructor(
        'tag:yaml.org,2002:timestamp',
        SafeConstructor.instanceMethod('constructYamlTimestamp');

SafeConstructor.addConstructor(
        'tag:yaml.org,2002:omap',
        SafeConstructor.instanceMethod('constructYamlOmap');

SafeConstructor.addConstructor(
        'tag:yaml.org,2002:pairs',
        SafeConstructor.instanceMethod('constructYamlPairs');

SafeConstructor.addConstructor(
        'tag:yaml.org,2002:set',
        SafeConstructor.instanceMethod('constructYamlSet');

SafeConstructor.addConstructor(
        'tag:yaml.org,2002:str',
        SafeConstructor.instanceMethod('constructYamlStr');

SafeConstructor.addConstructor(
        'tag:yaml.org,2002:seq',
        SafeConstructor.instanceMethod('constructYamlSeq');

SafeConstructor.addConstructor(
        'tag:yaml.org,2002:map',
        SafeConstructor.instanceMethod('constructYamlMap');

SafeConstructor.addConstructor(
        null,
        SafeConstructor.instanceMethod('constructUndefined');


var Constructor = exports.Constructor = new JS.Class('Constructor', SafeConstructor, {
  extend: { yamlConstructors: SafeConstructor.yamlConstructors.dup() }
});


Constructor.addConstructor(
    'tag:yaml.org,2002:js/null',
    Constructor.constructYamlNull)

Constructor.addConstructor(
    'tag:yaml.org,2002:js/bool',
    Constructor.constructYamlBool)

Constructor.addConstructor(
    'tag:yaml.org,2002:js/str',
    Constructor.constructYamlStr)

Constructor.addConstructor(
    'tag:yaml.org,2002:js/int',
    Constructor.constructYamlInt)

Constructor.addConstructor(
    'tag:yaml.org,2002:js/float',
    Constructor.constructYamlFloat)

Constructor.addConstructor(
    'tag:yaml.org,2002:js/array',
    Constructor.constructYamlSeq)

Constructor.addConstructor(
    'tag:yaml.org,2002:js/object',
    Constructor.constructYamlMap)


////////////////////////////////////////////////////////////////////////////////
// vim:ts=2:sw=2
////////////////////////////////////////////////////////////////////////////////