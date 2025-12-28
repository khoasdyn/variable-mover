// ============================================
// VARIABLE MOVER PLUGIN (WITH ALIAS SUPPORT)
// ============================================
// 
// WHAT THIS PLUGIN DOES:
// This plugin moves selected variables from one collection to another.
// Figma doesn't have this feature built-in, so we're creating it!
//
// KEY FEATURES:
//   - Users can select which specific variables to move
//   - "Select All" option for quick selection
//   - Duplicate detection prevents naming conflicts
//   - All variable types supported (COLOR, NUMBER, STRING, BOOLEAN)
//   - Layer bindings are automatically updated
//   - Variable scopes are preserved
//   - Variable aliases (links to other variables) are properly handled
//
// ============================================


// ============================================
// STEP 1: SHOW THE USER INTERFACE
// ============================================

figma.showUI(__html__, { width: 380, height: 600 });


// ============================================
// STEP 2: HELPER FUNCTIONS
// ============================================


// --------------------------------------------
// HELPER: Get All Collections (Simplified Format)
// --------------------------------------------

async function getAllCollections() {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  
  return collections.map(function(collection) {
    return {
      id: collection.id,
      name: collection.name,
      variableCount: collection.variableIds.length,
      modes: collection.modes.map(function(mode) {
        return {
          modeId: mode.modeId,
          name: mode.name
        };
      })
    };
  });
}


// --------------------------------------------
// HELPER: Get All Variables in a Collection
// --------------------------------------------

async function getVariablesInCollection(collectionId) {
  const collection = await figma.variables.getVariableCollectionByIdAsync(collectionId);
  
  if (!collection) {
    return [];
  }
  
  const variables = [];
  
  for (const variableId of collection.variableIds) {
    const variable = await figma.variables.getVariableByIdAsync(variableId);
    if (variable) {
      variables.push(variable);
    }
  }
  
  return variables;
}


// --------------------------------------------
// HELPER: Get Variable Names in a Collection
// --------------------------------------------

async function getVariableNamesInCollection(collectionId) {
  const variables = await getVariablesInCollection(collectionId);
  
  const names = new Set();
  for (const variable of variables) {
    names.add(variable.name);
  }
  
  return names;
}


// --------------------------------------------
// HELPER: Find Duplicate Names Between Collections
// --------------------------------------------

function findDuplicateNames(sourceVariables, destinationNames) {
  
  const duplicates = [];
  const canMove = [];
  
  for (const variable of sourceVariables) {
    if (destinationNames.has(variable.name)) {
      duplicates.push(variable);
    } else {
      canMove.push(variable);
    }
  }
  
  return { duplicates, canMove };
}


// --------------------------------------------
// HELPER: Create a New Variable (Without Values)
// --------------------------------------------
//
// This creates a new variable in the destination collection
// but does NOT set its values yet. We do this in two phases
// so we can properly handle variable aliases.
//
// Phase 1: Create all variables (build ID mapping)
// Phase 2: Set all values (can now resolve alias references)

async function createVariableInCollection(originalVariable, destinationCollection) {
  
  // Create the new variable
  const newVariable = figma.variables.createVariable(
    originalVariable.name,
    destinationCollection,
    originalVariable.resolvedType
  );
  
  // Copy the description
  if (originalVariable.description) {
    newVariable.description = originalVariable.description;
  }
  
  // Copy the hiddenFromPublishing setting
  newVariable.hiddenFromPublishing = originalVariable.hiddenFromPublishing;
  
  // Copy scopes (controls which properties the variable can be applied to)
  if (originalVariable.scopes && originalVariable.scopes.length > 0) {
    newVariable.scopes = originalVariable.scopes;
  }
  
  // Copy the code syntax if it exists
  if (originalVariable.codeSyntax) {
    // codeSyntax is an object like { WEB: "var(--color-primary)", ANDROID: "@color/primary" }
    for (const platform in originalVariable.codeSyntax) {
      newVariable.setVariableCodeSyntax(platform, originalVariable.codeSyntax[platform]);
    }
  }
  
  return newVariable;
}


// --------------------------------------------
// HELPER: Copy Variable Values (With Alias Support)
// --------------------------------------------
//
// This copies the values from the original variable to the new variable.
// It properly handles variable aliases (links to other variables).
//
// ALIAS HANDLING:
// When a value is an alias (link to another variable), we need to check:
//   1. Is the referenced variable ALSO being moved?
//      → Yes: Update the alias to point to the NEW variable ID
//      → No: Keep the alias pointing to the original variable
//
// Parameters:
//   - originalVariable: The source variable to copy values from
//   - newVariable: The destination variable to copy values to
//   - destinationCollection: The collection we're moving to
//   - idMapping: Object mapping old variable IDs to new variable objects

async function copyVariableValues(originalVariable, newVariable, destinationCollection, idMapping) {
  
  const destinationModes = destinationCollection.modes;
  const originalValues = originalVariable.valuesByMode;
  const originalModeIds = Object.keys(originalValues);
  
  for (let i = 0; i < destinationModes.length; i++) {
    const destinationMode = destinationModes[i];
    
    if (i < originalModeIds.length) {
      const originalModeId = originalModeIds[i];
      const originalValue = originalValues[originalModeId];
      
      // ===== HANDLE VARIABLE ALIASES =====
      //
      // An alias is when a variable's value is linked to another variable.
      // In Figma's API, this looks like:
      //   { type: 'VARIABLE_ALIAS', id: 'VariableID:123:456' }
      //
      // We need to handle two cases:
      //
      // CASE 1: The referenced variable is ALSO being moved
      //   → We need to update the alias to point to the NEW variable ID
      //   → Example: "color-01-duplicate" links to "color-01"
      //              Both are being moved from Collection A to B
      //              The alias should now point to "color-01" in Collection B
      //
      // CASE 2: The referenced variable is NOT being moved
      //   → Keep the alias pointing to the original variable
      //   → This creates a cross-collection reference
      //   → Example: "color-01-duplicate" links to "color-01"
      //              Only "color-01-duplicate" is being moved
      //              It should still link to "color-01" in the original collection
      
      if (originalValue && typeof originalValue === 'object' && originalValue.type === 'VARIABLE_ALIAS') {
        
        const referencedVariableId = originalValue.id;
        
        // Check if the referenced variable is also being moved
        if (idMapping[referencedVariableId]) {
          
          // CASE 1: Referenced variable IS being moved
          // Create a new alias pointing to the NEW variable
          const newReferencedVariable = idMapping[referencedVariableId];
          
          const newAlias = figma.variables.createVariableAlias(newReferencedVariable);
          newVariable.setValueForMode(destinationMode.modeId, newAlias);
          
          console.log('  Updated alias:', originalVariable.name, '→ new reference');
          
        } else {
          
          // CASE 2: Referenced variable is NOT being moved
          // Keep the original alias (cross-collection reference)
          // We need to check if the referenced variable still exists
          
          try {
            const referencedVariable = await figma.variables.getVariableByIdAsync(referencedVariableId);
            
            if (referencedVariable) {
              // The referenced variable exists, create alias to it
              const alias = figma.variables.createVariableAlias(referencedVariable);
              newVariable.setValueForMode(destinationMode.modeId, alias);
              
              console.log('  Kept alias:', originalVariable.name, '→', referencedVariable.name, '(cross-collection)');
            } else {
              // Referenced variable doesn't exist anymore
              // Skip this value (will use default)
              console.warn('  Warning: Referenced variable not found for', originalVariable.name);
            }
          } catch (error) {
            console.error('  Error resolving alias for', originalVariable.name, error);
          }
        }
        
      } else {
        
        // ===== HANDLE NORMAL VALUES =====
        // Not an alias, just copy the value directly
        newVariable.setValueForMode(destinationMode.modeId, originalValue);
      }
    }
  }
}


// --------------------------------------------
// HELPER: Find All Variable Bindings in Document
// --------------------------------------------

async function findAllVariableBindings(variableIds) {
  
  const targetVariableIds = new Set(variableIds);
  const allBindings = [];
  
  for (const page of figma.root.children) {
    // Load the page first (required by Figma API)
    await page.loadAsync();
    
    const allNodes = page.findAll();
    
    for (const node of allNodes) {
      if (!('boundVariables' in node) || !node.boundVariables) {
        continue;
      }
      
      const boundVars = node.boundVariables;
      
      for (const propertyName in boundVars) {
        const binding = boundVars[propertyName];
        
        if (Array.isArray(binding)) {
          for (let index = 0; index < binding.length; index++) {
            const item = binding[index];
            if (item && item.id && targetVariableIds.has(item.id)) {
              allBindings.push({
                node: node,
                property: propertyName,
                variableId: item.id,
                bindingIndex: index,
                isArrayBinding: true
              });
            }
          }
        } else if (binding && binding.id && targetVariableIds.has(binding.id)) {
          allBindings.push({
            node: node,
            property: propertyName,
            variableId: binding.id,
            bindingIndex: null,
            isArrayBinding: false
          });
        }
      }
    }
  }
  
  return allBindings;
}


// --------------------------------------------
// HELPER: Rebind a Variable Reference
// --------------------------------------------

async function rebindVariable(node, property, newVariable, bindingIndex, isArrayBinding) {
  
  try {
    if (!isArrayBinding) {
      if ('setBoundVariable' in node) {
        node.setBoundVariable(property, newVariable);
        return true;
      }
      return false;
    }
    
    if (property === 'fills' && 'fills' in node) {
      const currentFills = node.fills;
      if (!Array.isArray(currentFills) || bindingIndex >= currentFills.length) {
        return false;
      }
      const newFills = JSON.parse(JSON.stringify(currentFills));
      newFills[bindingIndex] = figma.variables.setBoundVariableForPaint(
        newFills[bindingIndex],
        'color',
        newVariable
      );
      node.fills = newFills;
      return true;
    }
    
    if (property === 'strokes' && 'strokes' in node) {
      const currentStrokes = node.strokes;
      if (!Array.isArray(currentStrokes) || bindingIndex >= currentStrokes.length) {
        return false;
      }
      const newStrokes = JSON.parse(JSON.stringify(currentStrokes));
      newStrokes[bindingIndex] = figma.variables.setBoundVariableForPaint(
        newStrokes[bindingIndex],
        'color',
        newVariable
      );
      node.strokes = newStrokes;
      return true;
    }
    
    if (property === 'effects' && 'effects' in node) {
      const currentEffects = node.effects;
      if (!Array.isArray(currentEffects) || bindingIndex >= currentEffects.length) {
        return false;
      }
      const newEffects = JSON.parse(JSON.stringify(currentEffects));
      newEffects[bindingIndex] = figma.variables.setBoundVariableForEffect(
        newEffects[bindingIndex],
        'color',
        newVariable
      );
      node.effects = newEffects;
      return true;
    }
    
    return false;
    
  } catch (error) {
    console.error('Failed to rebind variable:', property, error);
    return false;
  }
}


// --------------------------------------------
// HELPER: Convert Figma Type to Display Name
// --------------------------------------------

function getDisplayTypeName(figmaType) {
  if (figmaType === 'FLOAT') {
    return 'NUMBER';
  }
  return figmaType;
}


// ============================================
// STEP 3: LISTEN FOR MESSAGES FROM THE UI
// ============================================

figma.ui.on('message', async function(msg) {
  
  // ============================================
  // MESSAGE TYPE: 'get-collections'
  // ============================================
  
  if (msg.type === 'get-collections') {
    const collections = await getAllCollections();
    
    figma.ui.postMessage({
      type: 'collections-list',
      collections: collections
    });
  }
  
  
  // ============================================
  // MESSAGE TYPE: 'get-variables-preview'
  // ============================================
  
  if (msg.type === 'get-variables-preview') {
    const collectionId = msg.collectionId;
    const variables = await getVariablesInCollection(collectionId);
    
    const preview = variables.map(function(variable) {
      return {
        id: variable.id,
        name: variable.name,
        type: getDisplayTypeName(variable.resolvedType),
        description: variable.description || ''
      };
    });
    
    figma.ui.postMessage({
      type: 'variables-preview',
      variables: preview,
      count: preview.length
    });
  }
  
  
  // ============================================
  // MESSAGE TYPE: 'check-duplicates'
  // ============================================
  
  if (msg.type === 'check-duplicates') {
    
    const sourceCollectionId = msg.sourceCollectionId;
    const destinationCollectionId = msg.destinationCollectionId;
    
    const sourceVariables = await getVariablesInCollection(sourceCollectionId);
    const destinationNames = await getVariableNamesInCollection(destinationCollectionId);
    
    const result = findDuplicateNames(sourceVariables, destinationNames);
    
    const duplicatesForUI = result.duplicates.map(function(variable) {
      return {
        id: variable.id,
        name: variable.name,
        type: getDisplayTypeName(variable.resolvedType)
      };
    });
    
    const canMoveForUI = result.canMove.map(function(variable) {
      return {
        id: variable.id,
        name: variable.name,
        type: getDisplayTypeName(variable.resolvedType)
      };
    });
    
    figma.ui.postMessage({
      type: 'duplicates-check-result',
      duplicates: duplicatesForUI,
      canMove: canMoveForUI,
      duplicateCount: duplicatesForUI.length,
      canMoveCount: canMoveForUI.length
    });
  }
  
  
  // ============================================
  // MESSAGE TYPE: 'move-variables'
  // ============================================
  // 
  // This is the main action! Now with proper alias support.
  //
  // The process is now THREE phases (instead of two):
  //
  // PHASE 1: Create all new variables (WITHOUT values)
  //          This builds the ID mapping we need for alias resolution
  //
  // PHASE 2: Copy all values (WITH alias support)
  //          Now we can properly update alias references because
  //          we know the new IDs of all moved variables
  //
  // PHASE 3: Update layer bindings
  //
  // PHASE 4: Delete old variables
  
  if (msg.type === 'move-variables') {
    
    const sourceCollectionId = msg.sourceCollectionId;
    const destinationCollectionId = msg.destinationCollectionId;
    const selectedVariableIds = msg.selectedVariableIds || [];
    
    // ===== VALIDATION =====
    
    if (!sourceCollectionId || !destinationCollectionId) {
      figma.notify('Please select both source and destination collections!');
      figma.ui.postMessage({
        type: 'move-error',
        message: 'Please select both collections before moving.'
      });
      return;
    }
    
    if (sourceCollectionId === destinationCollectionId) {
      figma.notify('Source and destination cannot be the same!');
      figma.ui.postMessage({
        type: 'move-error',
        message: 'You cannot move variables to the same collection.'
      });
      return;
    }
    
    if (selectedVariableIds.length === 0) {
      figma.notify('No variables selected!');
      figma.ui.postMessage({
        type: 'move-error',
        message: 'Please select at least one variable to move.'
      });
      return;
    }
    
    // Fetch the collection objects
    const sourceCollection = await figma.variables.getVariableCollectionByIdAsync(sourceCollectionId);
    const destinationCollection = await figma.variables.getVariableCollectionByIdAsync(destinationCollectionId);
    
    if (!sourceCollection || !destinationCollection) {
      figma.notify('One of the collections no longer exists!');
      figma.ui.postMessage({
        type: 'move-error',
        message: 'Collection not found. It may have been deleted.'
      });
      return;
    }
    
    // Get selected variables
    const selectedIdsSet = new Set(selectedVariableIds);
    const allSourceVariables = await getVariablesInCollection(sourceCollectionId);
    
    const variablesToMove = allSourceVariables.filter(function(variable) {
      return selectedIdsSet.has(variable.id);
    });
    
    if (variablesToMove.length === 0) {
      figma.notify('No valid variables to move!');
      figma.ui.postMessage({
        type: 'move-error',
        message: 'The selected variables could not be found.'
      });
      return;
    }
    
    // Check for duplicates
    const destinationNames = await getVariableNamesInCollection(destinationCollectionId);
    const { duplicates, canMove: safeToMove } = findDuplicateNames(variablesToMove, destinationNames);
    
    if (safeToMove.length === 0) {
      figma.notify('All selected variables have duplicate names!');
      figma.ui.postMessage({
        type: 'move-error',
        message: 'All selected variables already exist in the destination.'
      });
      return;
    }
    
    figma.notify('Moving ' + safeToMove.length + ' variable(s)...');
    
    
    // ===== PHASE 1: CREATE NEW VARIABLES (WITHOUT VALUES) =====
    //
    // We create all variables FIRST, before setting any values.
    // This is crucial for handling variable aliases correctly.
    //
    // Why? Because a variable might reference another variable that
    // we're also moving. We need to know the NEW ID of that variable
    // before we can create the alias reference.
    //
    // By creating all variables first, we build a complete mapping
    // of oldId → newVariable that we can use in Phase 2.
    
    const idMapping = {};  // Maps old variable ID → new variable object
    let createSuccessCount = 0;
    let createErrorCount = 0;
    
    console.log('PHASE 1: Creating new variables (without values)...');
    console.log('  Selected:', selectedVariableIds.length);
    console.log('  Moving:', safeToMove.length);
    console.log('  Skipped (duplicates):', duplicates.length);
    
    for (const originalVariable of safeToMove) {
      try {
        // Create the variable (but don't set values yet)
        const newVariable = await createVariableInCollection(originalVariable, destinationCollection);
        
        // Store the mapping
        idMapping[originalVariable.id] = newVariable;
        
        createSuccessCount++;
        console.log('  Created:', originalVariable.name);
        
      } catch (error) {
        console.error('  Failed to create:', originalVariable.name, error);
        createErrorCount++;
      }
    }
    
    console.log('PHASE 1 complete:', createSuccessCount, 'created,', createErrorCount, 'failed');
    
    
    // ===== PHASE 2: COPY VALUES (WITH ALIAS SUPPORT) =====
    //
    // Now that all variables exist and we have the ID mapping,
    // we can properly copy values including aliases.
    //
    // For each alias value:
    //   - If the referenced variable is also being moved → use new ID
    //   - If not → keep the original reference (cross-collection)
    
    console.log('PHASE 2: Copying values...');
    
    let valueSuccessCount = 0;
    let valueErrorCount = 0;
    
    for (const originalVariable of safeToMove) {
      
      const newVariable = idMapping[originalVariable.id];
      
      if (!newVariable) {
        console.error('  No new variable found for:', originalVariable.name);
        valueErrorCount++;
        continue;
      }
      
      try {
        await copyVariableValues(originalVariable, newVariable, destinationCollection, idMapping);
        valueSuccessCount++;
        console.log('  Copied values:', originalVariable.name);
        
      } catch (error) {
        console.error('  Failed to copy values:', originalVariable.name, error);
        valueErrorCount++;
      }
    }
    
    console.log('PHASE 2 complete:', valueSuccessCount, 'copied,', valueErrorCount, 'failed');
    
    
    // ===== PHASE 3: UPDATE LAYER BINDINGS =====
    
    console.log('PHASE 3: Finding all variable bindings...');
    
    const oldVariableIds = Object.keys(idMapping);
    const allBindings = await findAllVariableBindings(oldVariableIds);
    
    console.log('  Found', allBindings.length, 'bindings to update');
    
    let rebindSuccessCount = 0;
    let rebindErrorCount = 0;
    
    for (const binding of allBindings) {
      const newVariable = idMapping[binding.variableId];
      
      if (!newVariable) {
        rebindErrorCount++;
        continue;
      }
      
      const success = await rebindVariable(
        binding.node,
        binding.property,
        newVariable,
        binding.bindingIndex,
        binding.isArrayBinding
      );
      
      if (success) {
        rebindSuccessCount++;
        console.log('  Rebound:', binding.node.name, '->', binding.property);
      } else {
        rebindErrorCount++;
      }
    }
    
    console.log('PHASE 3 complete:', rebindSuccessCount, 'rebound,', rebindErrorCount, 'failed');
    
    
    // ===== PHASE 4: DELETE OLD VARIABLES =====
    
    console.log('PHASE 4: Deleting old variables...');
    
    let deleteCount = 0;
    
    for (const oldVariableId of oldVariableIds) {
      try {
        const oldVariable = await figma.variables.getVariableByIdAsync(oldVariableId);
        if (oldVariable) {
          oldVariable.remove();
          deleteCount++;
        }
      } catch (error) {
        console.error('  Failed to delete variable:', oldVariableId, error);
      }
    }
    
    console.log('PHASE 4 complete:', deleteCount, 'deleted');
    
    
    // ===== SEND RESULTS TO UI =====
    
    let summaryMessage = 'Moved ' + createSuccessCount + ' variable';
    if (createSuccessCount !== 1) summaryMessage += 's';
    summaryMessage += ' to "' + destinationCollection.name + '"';
    
    if (duplicates.length > 0) {
      summaryMessage += ' (' + duplicates.length + ' skipped)';
    }
    
    figma.notify(summaryMessage);
    
    figma.ui.postMessage({
      type: 'move-complete',
      successCount: createSuccessCount,
      errorCount: createErrorCount,
      skippedCount: duplicates.length,
      rebindSuccessCount: rebindSuccessCount,
      rebindErrorCount: rebindErrorCount,
      deletedCount: deleteCount,
      destinationName: destinationCollection.name
    });
  }
  
  
  // ============================================
  // MESSAGE TYPE: 'close-plugin'
  // ============================================
  
  if (msg.type === 'close-plugin') {
    figma.closePlugin();
  }
});
