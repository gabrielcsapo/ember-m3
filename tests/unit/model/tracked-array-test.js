import sinon from 'sinon';
import { get } from '@ember/object';
import { run } from '@ember/runloop';
import { module, test } from 'qunit';
import { setupTest } from 'ember-qunit';
import DefaultSchema from 'ember-m3/services/m3-schema';
import { A } from '@ember/array';
import ManagedArray from 'ember-m3/managed-array';
import ObjectProxy from '@ember/object/proxy';

function computeNestedModel(key, value /*, modelName, schemaInterface */) {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return {
      attributes: value,
    };
  }
}

class TestSchema extends DefaultSchema {
  includesModel(modelName) {
    return /^com.example.bookstore\./i.test(modelName);
  }
  computeAttribute(key, value, modelName, schemaInterface) {
    if (Array.isArray(value)) {
      let nested = value.map((v) => {
        if (typeof v === 'object') {
          return schemaInterface.nested(computeNestedModel(key, v, modelName, schemaInterface));
        } else {
          return v;
        }
      });
      return schemaInterface.managedArray(nested);
    } else {
      let nested = computeNestedModel(key, value, modelName, schemaInterface);
      if (nested) {
        return schemaInterface.nested(nested);
      }
    }
  }
}

class TestSchemaOldHooks extends DefaultSchema {
  includesModel(modelName) {
    return /^com.example.bookstore\./i.test(modelName);
  }

  computeNestedModel(key, value, modelName, schemaInterface) {
    return computeNestedModel(key, value, modelName, schemaInterface);
  }
}

for (let testRun = 0; testRun < 2; testRun++) {
  module(
    `unit/model/tracked-array with ${testRun === 0 ? 'old hooks' : 'with computeAttribute'}`,
    function (hooks) {
      setupTest(hooks);

      hooks.beforeEach(function () {
        this.sinon = sinon.createSandbox();
        if (testRun === 0) {
          this.owner.register('service:m3-schema', TestSchemaOldHooks);
        } else if (testRun === 1) {
          this.owner.register('service:m3-schema', TestSchema);
        }

        this.store = this.owner.lookup('service:store');
      });

      test('tracked, non-reference, arrays resolve new values', function (assert) {
        let model = run(() =>
          this.store.push({
            data: {
              id: 'isbn:9780439708180',
              type: 'com.example.bookstore.Book',
              attributes: {
                name: `Harry Potter and the Sorcerer's Stone`,
                chapters: [
                  {
                    name: 'The Boy Who Lived',
                  },
                  2,
                ],
              },
            },
          })
        );

        let chapters = model.get('chapters');
        assert.ok(!chapters._isAllReference, 'chapters is a tracked array');
        assert.equal(chapters instanceof ManagedArray, true, 'chapters is a tracked array');

        let chapter1 = chapters.objectAt(0);
        assert.equal(chapter1.constructor.isModel, true, 'chapters has resolved values');
        assert.equal(
          chapter1.get('name'),
          'The Boy Who Lived',
          `chapters's embedded records can resolve values`
        );

        assert.equal(
          chapters.objectAt(1),
          2,
          'chapters is a heterogenous mix of resolved and unresolved values'
        );

        run(() => chapters.pushObject(3));
        assert.equal(chapters.objectAt(2), 3, `chapters accepts new values that don't resolve`);

        run(() => chapters.pushObject({ name: 'The Vanishing Glass' }));

        let chapter2 = chapters.objectAt(3);
        assert.equal(chapter2.constructor.isModel, true, 'new values can be resolved');
        assert.equal(get(chapter2, 'name'), 'The Vanishing Glass', `new values can be resolved`);
      });

      test('tracked nested array, non-reference, arrays resolve new values', function (assert) {
        let model = run(() =>
          this.store.push({
            data: {
              id: 'isbn:9780439708180',
              type: 'com.example.bookstore.Book',
              attributes: {
                name: `Harry Potter and the Sorcerer's Stone`,
                chapters: [
                  {
                    name: 'The Boy Who Lived',
                  },
                ],
              },
            },
          })
        );

        let chapters = model.get('chapters');
        assert.ok(!chapters._isAllReference, 'chapters is a tracked array');
        assert.equal(chapters instanceof ManagedArray, true, 'chapters is a tracked array');

        let chapter1 = chapters.objectAt(0);
        assert.equal(chapter1.constructor.isModel, true, 'chapters has resolved values');
        assert.equal(
          chapter1.get('name'),
          'The Boy Who Lived',
          `chapters's embedded records can resolve values`
        );

        run(() => chapters.pushObject({ name: 'The Vanishing Glass' }));

        let chapter2 = chapters.objectAt(1);
        assert.equal(chapter2.constructor.isModel, true, 'new values can be resolved');
        assert.equal(get(chapter2, 'name'), 'The Vanishing Glass', `new values can be resolved`);

        //Remove object
        run(() => chapters.shiftObject());
        assert.equal(chapters.length, 1, 'Item is removed');
        chapter1 = chapters.objectAt(0);
        assert.equal(chapter1.constructor.isModel, true, 'chapters has resolved values');
        assert.equal(
          get(chapter1, 'name'),
          'The Vanishing Glass',
          `First item is removed from the array`
        );

        //Push new object
        run(() => chapters.pushObject({ name: 'The Vanishing Glass Pt. 2' }));
        assert.equal(chapters.length, 2, 'Item is pushed at the end');
        let chapter3 = chapters.objectAt(1);
        assert.equal(chapter3.constructor.isModel, true, 'new values can be resolved');
        assert.equal(
          get(chapter3, 'name'),
          'The Vanishing Glass Pt. 2',
          `new values can be resolved`
        );

        //unshit object
        run(() => chapters.unshiftObject({ name: 'The Boy Who Lived' }));
        chapter1 = chapters.objectAt(0);
        assert.equal(chapters.length, 3, 'Item is removed');
        assert.equal(chapter1.constructor.isModel, true, 'chapters has resolved values');
        assert.equal(chapter1.get('name'), 'The Boy Who Lived', `added record at the start`);
      });

      test('unloaded records are automatically removed from tracked arrays', function (assert) {
        let observerDidChange;
        let model = run(() =>
          this.store.push({
            data: {
              id: 'isbn:9780439708180',
              type: 'com.example.bookstore.Book',
              attributes: {
                name: `Harry Potter and the Sorcerer's Stone`,
                chapters: [],
              },
            },
            included: [
              {
                id: 'isbn:9780439708180:chapter:1',
                type: 'com.example.bookstore.Chapter',
                attributes: {
                  name: 'The Boy Who Lived',
                },
              },
              {
                id: 'isbn:9780439708180:chapter:2',
                type: 'com.example.bookstore.Chapter',
                attributes: {
                  name: 'The Vanishing Glass',
                },
              },
            ],
          })
        );

        let chapter1 = this.store.peekRecord(
          'com.example.bookstore.Chapter',
          'isbn:9780439708180:chapter:1'
        );
        let chapter2 = this.store.peekRecord(
          'com.example.bookstore.Chapter',
          'isbn:9780439708180:chapter:2'
        );
        let chapters = model.get('chapters');

        run(() => chapters.pushObject(chapter1));
        run(() => chapters.pushObject(chapter2));

        assert.deepEqual(
          chapters.mapBy('name'),
          ['The Boy Who Lived', 'The Vanishing Glass'],
          'records are added to tracked arrays'
        );

        chapters.addArrayObserver(this, {
          willChange: () => {},
          didChange: (array, index, removeCount) => {
            observerDidChange = removeCount;
          },
        });

        run(() => chapter2.unloadRecord());
        assert.equal(observerDidChange, 1, 'removal of the record notified that it was removed');

        assert.deepEqual(
          chapters.mapBy('name'),
          ['The Boy Who Lived'],
          'unloaded records are removed from tracked arrays'
        );
      });

      test('embedded models can be added to tracked arrays', function (assert) {
        this.schema = this.owner.lookup('service:m3-schema');
        this.sinon.spy(this.schema, 'setAttribute');

        let [book1, book2] = run(() =>
          this.store.push({
            data: [
              {
                id: 'isbn:9780439708180',
                type: 'com.example.bookstore.Book',
                attributes: {
                  name: `Harry Potter and the Sorcerer's Stone`,
                  chapters: [
                    {
                      name: 'The Boy Who Lived',
                    },
                  ],
                },
              },
              {
                id: 'urn:isbn9780439064873',
                type: 'com.example.bookstore.Book',
                attributes: {
                  name: `Harry Potter and the Chamber of Secrets`,
                  chapters: [
                    {
                      name: 'The Worst Birthday',
                    },
                  ],
                },
              },
            ],
          })
        );

        let book1Chapter1 = book1.get('chapters').objectAt(0);
        let book2Chapter1 = book2.get('chapters').objectAt(0);
        book2.get('chapters').pushObject(book1Chapter1);

        assert.equal(this.schema.setAttribute.callCount, 1, 'setAttribute called once');
        assert.deepEqual(this.schema.setAttribute.lastCall.args.slice(0, -1), [
          // model name is "normalized"
          'com.example.bookstore.book',
          'chapters',
          [book2Chapter1, book1Chapter1],
        ]);

        assert.deepEqual(
          book1.get('chapters').mapBy('name'),
          ['The Boy Who Lived'],
          'book1 chapters correct'
        );
        assert.deepEqual(
          book2.get('chapters').mapBy('name'),
          ['The Worst Birthday', 'The Boy Who Lived'],
          'book2 chapters correct'
        );

        assert.strictEqual(
          book1.get('chapters').objectAt(0),
          book2.get('chapters').objectAt(1),
          'embedded model can be shared between tracked arrays'
        );
      });

      test('tracked array interop with Ember Arrays', function (assert) {
        let model = run(() =>
          this.store.push({
            data: {
              id: 'isbn:9780439708180',
              type: 'com.example.bookstore.Book',
              attributes: {
                name: `Harry Potter and the Sorcerer's Stone`,
                chapters: [
                  {
                    name: 'The Boy Who Lived',
                  },
                ],
              },
            },
          })
        );

        let chapters = model.get('chapters');
        assert.ok(!chapters._isAllReference, 'chapters is a tracked array');
        assert.equal(chapters instanceof ManagedArray, true, 'chapters is a tracked array');
        let objectAt = chapters.objectAt;
        let push = chapters.push;
        assert.equal(chapters, A(chapters), 'Ember.A doesnt replace the tracked array');
        assert.equal(push, A(chapters).push, 'Ember.A doesnt modify native array methods');
        assert.equal(objectAt, A(chapters).objectAt, 'Ember.A doesnt modify ember array methods');
      });

      // We have found instances in the wild of users wrapping models in an ember object proxy and returning
      // those as array members from schema hooks. While not recommneded and bound to go away in modern ember, this test asserts
      // that we do not accidentally trigger the object proxy property access assertions.
      test('ember proxy objects can be pushed into nested arrays', function (assert) {
        this.schema = this.owner.lookup('service:m3-schema');

        let chapter = this.store.push({
          data: {
            id: 'chapter',
            type: 'com.example.bookstore.Chapter',
            attributes: {
              name: `Chapter 1`,
            },
          },
        });
        this.schema.computeAttribute = (key, value, modelName, schemaInterface) => {
          if (value instanceof Array) {
            return schemaInterface.managedArray([
              ObjectProxy.create({
                content: chapter,
              }),
            ]);
          } else {
            return value;
          }
        };

        let book = this.store.push({
          data: {
            id: 'isbn:9780439708180',
            type: 'com.example.bookstore.Book',
            attributes: {
              name: `Harry Potter and the Sorcerer's Stone`,
              chapters: [
                {
                  name: 'The Boy Who Lived',
                },
              ],
            },
          },
        });

        assert.strictEqual(
          book.get('chapters').objectAt(0).get('name'),
          'Chapter 1',
          'Returning an object proxy as a member of a managed array does not error out'
        );
      });

      // This is true of references as well in the CUSTOM_MODEL_CLASS world
      test('tracked arrays do not access _internalModel of non references', function (assert) {
        this.schema = this.owner.lookup('service:m3-schema');

        this.schema.computeAttribute = (key, value, modelName, schemaInterface) => {
          if (value instanceof Array) {
            return schemaInterface.managedArray([
              {
                name: 'Chapter 1',
                get _internalModel() {
                  assert.ok(false, 'accessed _internalModel in a pojo');
                  return null;
                },
              },
            ]);
          } else {
            return value;
          }
        };

        let book = this.store.push({
          data: {
            id: 'isbn:9780439708180',
            type: 'com.example.bookstore.Book',
            attributes: {
              name: `Harry Potter and the Sorcerer's Stone`,
              chapters: [
                {
                  name: 'The Boy Who Lived',
                },
              ],
            },
          },
        });

        assert.strictEqual(
          book.get('chapters').objectAt(0).name,
          'Chapter 1',
          'We accessed the first chapter and did not touch the _internalModel property'
        );
      });
    }
  );
}
