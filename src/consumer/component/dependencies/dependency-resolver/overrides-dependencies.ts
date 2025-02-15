import minimatch from 'minimatch';
import {
  COMPONENT_ORIGINS,
  MANUALLY_REMOVE_DEPENDENCY,
  MANUALLY_ADD_DEPENDENCY,
  OVERRIDE_COMPONENT_PREFIX,
  DEPENDENCIES_FIELDS
} from '../../../../constants';
import ComponentMap from '../../../bit-map/component-map';
import { BitId, BitIds } from '../../../../bit-id';
import Component from '../../../component/consumer-component';
import Consumer from '../../../../consumer/consumer';
import GeneralError from '../../../../error/general-error';
import hasWildcard from '../../../../utils/string/has-wildcard';
import { FileType, AllDependencies } from './dependencies-resolver';

export type ManuallyChangedDependencies = {
  dependencies?: string[];
  devDependencies?: string[];
  peerDependencies?: string[];
};

export default class OverridesDependencies {
  component: Component;
  consumer: Consumer;
  componentMap: ComponentMap;
  componentFromModel: Component | null | undefined;
  manuallyRemovedDependencies: ManuallyChangedDependencies;
  manuallyAddedDependencies: ManuallyChangedDependencies;
  constructor(component: Component, consumer: Consumer) {
    this.component = component;
    this.consumer = consumer; // $FlowFixMe
    // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
    this.componentMap = this.component.componentMap;
    this.componentFromModel = this.component.componentFromModel;
    this.manuallyRemovedDependencies = {};
    this.manuallyAddedDependencies = {};
  }

  shouldIgnoreFile(file: string, fileType: FileType): boolean {
    const shouldIgnoreByGlobMatch = (patterns: string[]) => {
      return patterns.some(pattern => minimatch(file, pattern));
    };
    const field = fileType.isTestFile ? 'devDependencies' : 'dependencies';
    const ignoreField = this.component.overrides.getIgnoredFiles(field);
    const ignore = shouldIgnoreByGlobMatch(ignoreField);
    if (ignore) {
      this._addManuallyRemovedDep(field, file);
    }
    return ignore;
  }

  shouldIgnorePackage(packageName: string, fileType: FileType): boolean {
    const field = fileType.isTestFile ? 'devDependencies' : 'dependencies';
    return this.shouldIgnorePackageByType(packageName, field);
  }

  shouldIgnorePackageByType(packageName: string, field: string): boolean {
    const shouldIgnorePackage = (packages: string[]) => {
      return packages.some(pkg => pkg === packageName);
    };
    const ignoreField = this.component.overrides.getIgnoredPackages(field);
    const ignore = shouldIgnorePackage(ignoreField);
    if (ignore) {
      this._addManuallyRemovedDep(field, packageName);
    }
    return ignore;
  }

  shouldIgnorePeerPackage(packageName: string): boolean {
    const shouldIgnorePackage = (packages: string[]) => {
      return packages.some(pkg => pkg === packageName);
    };
    const field = 'peerDependencies';
    const ignorePeer = this.component.overrides.getIgnoredPackages(field);
    const ignore = shouldIgnorePackage(ignorePeer);
    if (ignore) {
      this._addManuallyRemovedDep(field, packageName);
    }
    return ignore;
  }

  shouldIgnoreComponent(componentId: BitId, fileType: FileType): boolean {
    const componentIdStr = componentId.toStringWithoutVersion();
    const shouldIgnore = (ids: string[]) => {
      return ids.some(idStr => {
        if (hasWildcard(idStr)) {
          // we don't support wildcards for components for now. it gets things complicated
          // and may cause unpredicted behavior especially for imported that the originally ignored
          // wildcards interfere with legit components
          return null;
        }
        return componentId.toStringWithoutVersion() === idStr || componentId.toStringWithoutScopeAndVersion() === idStr;
      });
    };
    const field = fileType.isTestFile ? 'devDependencies' : 'dependencies';
    const ignoreField = this.component.overrides.getIgnoredComponents(field);
    const ignore = shouldIgnore(ignoreField);
    if (ignore) {
      this._addManuallyRemovedDep(field, componentIdStr);
    }
    return ignore;
  }

  getDependenciesToAddManually(
    packageJson: Record<string, any> | null | undefined,
    existingDependencies: AllDependencies
  ): { components: Record<string, any>; packages: Record<string, any> } | null | undefined {
    const overrides = this.component.overrides.componentOverridesData;
    if (!overrides) return null;
    const idsFromBitmap = this.consumer.bitMap.getAllBitIds([COMPONENT_ORIGINS.AUTHORED, COMPONENT_ORIGINS.IMPORTED]);
    const components = {};
    const packages = {};
    DEPENDENCIES_FIELDS.forEach(depField => {
      if (!overrides[depField]) return;
      const idsFromModel = this.componentFromModel ? this.componentFromModel.dependencies.getAllIds() : new BitIds();
      Object.keys(overrides[depField]).forEach(dependency => {
        const dependencyValue = overrides[depField][dependency];
        if (dependencyValue === MANUALLY_REMOVE_DEPENDENCY) return;
        const componentId = this._getComponentIdToAdd(
          depField,
          dependency,
          dependencyValue,
          idsFromBitmap,
          idsFromModel
        );
        if (componentId) {
          const dependencyExist = existingDependencies[depField].find(d =>
            d.id.isEqualWithoutScopeAndVersion(componentId)
          );
          if (!dependencyExist) {
            this._addManuallyAddedDep(depField, componentId.toString());
            components[depField] ? components[depField].push(componentId) : (components[depField] = [componentId]);
          }
          return;
        }
        const addedPkg = this._manuallyAddPackage(depField, dependency, dependencyValue, packageJson);
        if (addedPkg) {
          packages[depField] = Object.assign(packages[depField] || {}, addedPkg);
        }
      });
    });
    return { components, packages };
  }

  _getComponentIdToAdd(
    field: string,
    dependency: string,
    dependencyValue: string,
    idsFromBitmap: BitIds,
    idsFromModel: BitIds
  ): BitId | null | undefined {
    if (field === 'peerDependencies') return null;
    if (!dependency.startsWith(OVERRIDE_COMPONENT_PREFIX)) return null;
    dependency = dependency.replace(OVERRIDE_COMPONENT_PREFIX, '');
    const idFromBitMap =
      idsFromBitmap.searchStrWithoutVersion(dependency) || idsFromBitmap.searchStrWithoutScopeAndVersion(dependency);
    const idFromModel =
      idsFromModel.searchStrWithoutVersion(dependency) || idsFromModel.searchStrWithoutScopeAndVersion(dependency);
    if (!idFromBitMap && !idFromModel) return null;
    // $FlowFixMe one of them must be set (see one line above)
    // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
    const id: BitId = idFromModel || idFromBitMap;
    return dependencyValue === MANUALLY_ADD_DEPENDENCY ? id : id.changeVersion(dependencyValue);
  }

  _manuallyAddPackage(
    field: string,
    dependency: string,
    dependencyValue: string,
    packageJson: Record<string, any> | null | undefined
  ): Record<string, any> | null | undefined {
    const packageVersionToAdd = (): string | null | undefined => {
      if (dependencyValue !== MANUALLY_ADD_DEPENDENCY) {
        return dependencyValue;
      }
      if (!packageJson) return null;
      for (const depField of DEPENDENCIES_FIELDS) {
        if (packageJson[depField]) {
          const found = Object.keys(packageJson[depField]).find(pkg => pkg === dependency);
          if (found) return packageJson[depField][dependency];
        }
      }
      return null;
    };
    const versionToAdd = packageVersionToAdd();
    if (!versionToAdd) {
      throw new GeneralError(`unable to manually add the dependency "${dependency}" into "${this.component.id.toString()}".
it's not an existing component, nor existing package`);
    }
    const packageStr = `${dependency}@${versionToAdd}`;
    this._addManuallyAddedDep(field, packageStr);

    return { [dependency]: versionToAdd };
  }

  _addManuallyRemovedDep(field: string, value: string) {
    this.manuallyRemovedDependencies[field]
      ? this.manuallyRemovedDependencies[field].push(value)
      : (this.manuallyRemovedDependencies[field] = [value]);
  }

  _addManuallyAddedDep(field: string, value: string) {
    this.manuallyAddedDependencies[field]
      ? this.manuallyAddedDependencies[field].push(value)
      : (this.manuallyAddedDependencies[field] = [value]);
  }
}
