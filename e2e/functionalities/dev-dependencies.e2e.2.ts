import * as path from 'path';
import chai, { expect } from 'chai';
import Helper from '../../src/e2e-helper/e2e-helper';
import * as fixtures from '../fixtures/fixtures';
import { statusWorkspaceIsCleanMsg } from '../../src/cli/commands/public-cmds/status-cmd';
import BitsrcTester, { username, supportTestingOnBitsrc } from '../bitsrc-tester';

chai.use(require('chai-fs'));

describe('dev-dependencies functionality', function() {
  this.timeout(0);
  const helper = new Helper();
  after(() => {
    helper.scopeHelper.destroy();
  });
  describe('environment with compiler and tester', () => {
    let clonedScope;
    before(() => {
      helper.scopeHelper.setNewLocalAndRemoteScopes();
      helper.env.importCompiler('bit.envs/compilers/babel@0.0.20');
      helper.env.importTester('bit.envs/testers/mocha@0.0.12');
      clonedScope = helper.scopeHelper.cloneLocalScope();
    });
    describe('with dev-dependencies same as dependencies', () => {
      let barFoo;
      before(() => {
        helper.fs.createFile('utils', 'is-type.js', fixtures.isTypeES6);
        helper.fixtures.addComponentUtilsIsType();
        helper.fs.createFile('utils', 'is-string.js', fixtures.isStringES6);
        helper.fixtures.addComponentUtilsIsString();
        helper.fixtures.createComponentBarFoo(fixtures.barFooES6);
        helper.fixtures.addComponentBarFoo();

        helper.fs.createFile('bar', 'foo.spec.js', fixtures.barFooSpecES6(true));
        helper.npm.installNpmPackage('chai', '4.1.2');
        helper.command.addComponent('bar/foo.js', { i: 'bar/foo', t: 'bar/foo.spec.js' });
        helper.command.build(); // needed for building the dependencies
        helper.command.tagAllComponents();
        barFoo = helper.command.catComponent('bar/foo@0.0.1');
      });
      it('should not save the dev-dependencies because they are the same as dependencies', () => {
        expect(barFoo.devDependencies).to.be.an('array').that.is.empty;
      });
      it('should not save the anything to flattened-dev-dependencies', () => {
        expect(barFoo.flattenedDevDependencies).to.be.an('array').that.is.empty;
      });
      it('should save "chai" in the dev-packages because it is only required in the tests files', () => {
        expect(barFoo.devPackageDependencies)
          .to.be.an('object')
          .that.has.property('chai');
      });
      it('should not save "chai" in the packages because it is not required in non-test files', () => {
        expect(barFoo.packageDependencies).to.be.an('object').that.is.empty;
      });
      it('should leave the dependencies intact', () => {
        expect(barFoo.dependencies)
          .to.be.an('array')
          .that.have.lengthOf(1);
        expect(barFoo.dependencies[0].id.name).to.equal('utils/is-string');
        expect(barFoo.dependencies[0].id.version).to.equal('0.0.1');
      });
      it('should leave the flattened-dependencies intact', () => {
        expect(barFoo.flattenedDependencies).to.deep.include({ name: 'utils/is-type', version: '0.0.1' });
        expect(barFoo.flattenedDependencies).to.deep.include({ name: 'utils/is-string', version: '0.0.1' });
      });
    });
    describe('without dependencies and with dev-dependencies', () => {
      let barFoo;
      let localScope;
      before(() => {
        // foo.js doesn't have any dependencies. foo.spec.js does have dependencies.
        helper.scopeHelper.getClonedLocalScope(clonedScope);
        helper.fs.createFile('utils', 'is-type.js', fixtures.isTypeES6);
        helper.fixtures.addComponentUtilsIsType();
        helper.fs.createFile('utils', 'is-string.js', fixtures.isStringES6);
        helper.fixtures.addComponentUtilsIsString();
        helper.fixtures.createComponentBarFoo('console.log("got foo")');
        helper.fixtures.addComponentBarFoo();

        helper.fs.createFile(
          'bar',
          'foo.spec.js',
          `const expect = require('chai').expect;
const foo = require('../utils/is-string.js');

describe('foo', () => {
  it('should display "got is-type and got is-string"', () => {
    expect(foo()).to.equal('got is-type and got is-string');
  });
});`
        );
        helper.npm.installNpmPackage('chai', '4.1.2');
        helper.command.addComponent('bar/foo.js', { i: 'bar/foo', t: 'bar/foo.spec.js' });
        helper.command.build(); // needed for building the dependencies
        helper.command.tagAllComponents();
        localScope = helper.scopeHelper.cloneLocalScope();
        barFoo = helper.command.catComponent('bar/foo@0.0.1');
      });
      it('should save the dev-dependencies', () => {
        expect(barFoo.devDependencies)
          .to.be.an('array')
          .that.have.lengthOf(1);
        expect(barFoo.devDependencies[0].id).to.deep.equal({ name: 'utils/is-string', version: '0.0.1' });
      });
      it('should save the flattened-dev-dependencies', () => {
        expect(barFoo.flattenedDevDependencies).to.deep.include({ name: 'utils/is-type', version: '0.0.1' });
        expect(barFoo.flattenedDevDependencies).to.deep.include({ name: 'utils/is-string', version: '0.0.1' });
      });
      it('should save "chai" in the dev-packages', () => {
        expect(barFoo.devPackageDependencies)
          .to.be.an('object')
          .that.has.property('chai');
      });
      it('should not save "chai" in the packages', () => {
        expect(barFoo.packageDependencies).to.be.an('object').that.is.empty;
      });
      it('should not save anything into dependencies', () => {
        expect(barFoo.dependencies).to.be.an('array').that.is.empty;
      });
      it('should not save anything into flattened-dependencies', () => {
        expect(barFoo.flattenedDependencies).to.be.an('array').that.is.empty;
      });
      it('bit status should not show any component as modified', () => {
        const output = helper.command.runCmd('bit status');
        expect(output).to.have.a.string('staged components');
      });
      describe('export and import to a new scope', () => {
        before(() => {
          helper.command.exportAllComponents();
          helper.scopeHelper.reInitLocalScope();
          helper.scopeHelper.addRemoteScope();
          helper.command.importComponent('bar/foo');
        });
        it('tests should pass', () => {
          const output = helper.command.testComponent('bar/foo');
          expect(output).to.have.string('tests passed');
        });
      });
      (supportTestingOnBitsrc ? describe : describe.skip)('export and import dependencies as packages', () => {
        let scopeName;
        let scopeId;
        let bitsrcTester;
        before(() => {
          bitsrcTester = new BitsrcTester();
          helper.scopeHelper.getClonedLocalScope(localScope);
          return bitsrcTester
            .loginToBitSrc()
            .then(() => bitsrcTester.createScope())
            .then(scope => {
              scopeName = scope;
              scopeId = `${username}.${scopeName}`;
              helper.command.exportAllComponents(scopeId);
              helper.scopeHelper.reInitLocalScope();
              helper.command.runCmd(`bit import ${scopeId}/bar/foo`);
            });
        });
        after(() => {
          return bitsrcTester.deleteScope(scopeName);
        });
        it('should save the bit-dev-dependencies component as devDependencies packages in package.json', () => {
          const packageJson = helper.packageJson.read(path.join(helper.scopes.localPath, 'components/bar/foo'));
          const id = `@bit/${scopeId}.utils.is-string`;
          expect(packageJson.dependencies).to.not.have.property(id);
          expect(packageJson.devDependencies).to.have.property(id);
        });
      });
    });
  });
  describe('dev-dependency of a nested component', () => {
    let output;
    before(() => {
      helper.scopeHelper.setNewLocalAndRemoteScopes();
      helper.fs.createFile('bar', 'foo.js', fixtures.barFooFixture);
      helper.fs.createFile('utils', 'is-string-spec.js', fixtures.isString);
      helper.fs.createFile('utils', 'is-string.js', '');
      helper.fs.createFile('utils', 'is-type.js', fixtures.isType);
      helper.fixtures.addComponentBarFoo();
      helper.fixtures.addComponentUtilsIsType();
      helper.command.addComponent('utils/is-string.js', {
        m: 'utils/is-string.js',
        i: 'utils/is-string',
        t: 'utils/is-string-spec.js'
      });
      helper.command.tagAllComponents();
      helper.command.exportAllComponents();

      helper.scopeHelper.reInitLocalScope();
      helper.scopeHelper.addRemoteScope();
      output = helper.command.importComponent('bar/foo');
    });
    it('should be able to import with no errors', () => {
      expect(output).to.have.string('successfully imported');
    });
    it('bit status should show a clean state', () => {
      const statusOutput = helper.command.runCmd('bit status');
      expect(statusOutput).to.have.a.string(statusWorkspaceIsCleanMsg);
    });
  });
  describe('dev-dependency that requires prod-dependency', () => {
    let barFoo;
    before(() => {
      helper.scopeHelper.reInitLocalScope();
      helper.fixtures.createComponentBarFoo();
      helper.fs.createFile('bar', 'foo.spec.js', fixtures.barFooFixture);
      helper.fs.createFile('utils', 'is-string.js', fixtures.isString);
      helper.fs.createFile('utils', 'is-type.js', fixtures.isType);
      helper.command.addComponent('bar', { i: 'bar/foo', m: 'bar/foo.js', t: 'bar/foo.spec.js' });
      helper.fixtures.addComponentUtilsIsString();
      helper.fixtures.addComponentUtilsIsType();
      helper.command.tagAllComponents();
      barFoo = helper.command.catComponent('bar/foo@latest');

      // as an intermediate step, make sure barFoo has is-string as a dev dependency only
      expect(barFoo.dependencies).to.have.lengthOf(0);
      expect(barFoo.devDependencies).to.have.lengthOf(1);
      expect(barFoo.devDependencies[0].id.name).to.equal('utils/is-string');
    });
    it('should include the prod dependencies inside flattenedDevDependencies', () => {
      expect(barFoo.flattenedDevDependencies).to.deep.include({ name: 'utils/is-type', version: '0.0.1' });
    });
  });
});
