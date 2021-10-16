/* Copyright 2021 GdH <https://github.com/G-dH>
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

'use strict';

const {GObject, GLib, St, Shell, Gdk} = imports.gi;
const Clutter                = imports.gi.Clutter;
const Meta                   = imports.gi.Meta;
const Main                   = imports.ui.main;
const AltTab                 = imports.ui.altTab;
const SwitcherPopup          = imports.ui.switcherPopup;

const AppDisplay             = imports.ui.appDisplay;
const Dash                   = imports.ui.dash;

const ExtensionUtils         = imports.misc.extensionUtils;
const Me                     = ExtensionUtils.getCurrentExtension();
const Settings               = Me.imports.settings;
const ActionLib              = Me.imports.actions;

const Config                 = imports.misc.config;
var   shellVersion           = Config.PACKAGE_VERSION;
var   GNOME40 = shellVersion.startsWith('4')
    ? GNOME40 = true
    : GNOME40 = false;

const options = new Settings.MscOptions();

const SwitcherModes = {
    WINDOWS: 0,
    APPS:    1,
};

const FilterModes = {
    ALL:       1,
    WORKSPACE: 2,
    MONITOR:   3,
};

const FilterModeLabels = ['',
    _('ALL'),
    _('WS '),
    _('MON')];

const Positions = {
    TOP:    1,
    CENTER: 2,
    BOTTOM: 3,
};

const SortingModes = {
    MRU:                  1,
    STABLE_SEQUENCE:      2,
    STABLE_CURRENT_FIRST: 3,
};

const AppSortingModes = {
    MRU:    1,
    STABLE: 2,
};

const SortingModesLabels = ['',
    _('MRU'),
    _('STABLE'),
    _('STABLE - current 1.')];

const GroupModes = {
    NONE:              1,
    CURRENT_MON_FIRST: 2,
    APPS:              3,
    WORKSPACES:        4,
};

const GroupModeLabels = ['',
    _('NONE'),
    _('MON FIRST'),
    _('APPS'),
    _('WS')];

const SelectionModes = {
    NONE:  -1,
    FIRST:  0,
    SECOND: 1,
    ACTIVE: 2,
};

const Actions = Settings.Actions;

let WS_INDEXES;
let HOT_KEYS;
let SHIFT_AZ_HOTKEYS;
let showHotKeys;

let APP_ICON_SIZE           = 64;
let WINDOW_PREVIEW_SIZE     = 128;
let APP_MODE_ICON_SIZE      = 96;
let SINGLE_APP_PREVIEW_SIZE = 0;
let INFO = true;

let _cancelTimeout = false;

function _shiftPressed() {
    return global.get_pointer()[2] & Clutter.ModifierType.SHIFT_MASK;
}

function _ctrlPressed(state = 0) {
    let result;
    if (!state)
        state = global.get_pointer()[2];
    return state & Clutter.ModifierType.CONTROL_MASK;
}

function _superPressed() {
    return global.get_pointer()[2] & Clutter.ModifierType.SUPER_MASK;
}

function _getWindowApp(metaWindow) {
    let tracker = Shell.WindowTracker.get_default();
    return tracker.get_window_app(metaWindow);
}

function _getRunningAppsIds() {
    let running = [];
    Shell.AppSystem.get_default().get_running().forEach(a => running.push(a.get_id()));
    return running;
}

function _convertAppInfoToShellApp(appInfo) {
    return Shell.AppSystem.get_default().lookup_app(appInfo.get_id());
}

function mod(a, b) {
    return (a + b) % b;
}


var   WindowSwitcherPopup = GObject.registerClass(
class WindowSwitcherPopup extends SwitcherPopup.SwitcherPopup {
    _init() {
        super._init();
        this._actions              = new ActionLib.Actions();

        // Global options
        // filter out all modifiers except Shift|Ctrl|Alt|Super and get those used in the shortcut that triggered this popup
        this._modifierMask         = global.get_pointer()[2] & 77; // 77 covers Shift|Ctrl|Alt|Super
        this._keyBind              = '';
 
        this.KEYBOARD_TRIGGERED    = true;  // whether was popup triggered by a keyboard. when true, POSITION_POINTER will be ignored
        this.POSITION_POINTER      = options.switcherPopupPointer; // place popup at pointer position
        this.POPUP_POSITION        = options.switcherPopupPosition;
        this.NO_MODS_TIMEOUT       = options.switcherPopupPointerTimeout;
        this.INITIAL_DELAY         = options.switcherPopupTimeout;
        this.WRAPAROUND            = options.switcherPopupWrap;
        this.ACTIVATE_ON_HIDE      = options.switcherPopupActivateOnHide;
        HOT_KEYS                   = options.switcherPopupHotKeys;
        SHIFT_AZ_HOTKEYS           = options.switcherPopupShiftHotkeys;
        INFO                       = options.switcherPopupInfo;
        this.SHOW_WIN_IMEDIATELY   = options.switcherPopupShowImmediately;
        this.SHOW_WS_INDEX         = options.wsSwitchIndicator;
        this.SEARCH_ALL            = options.winSwitcherPopupSearchAll;
        this.OVERLAY_TITLE         = options.switcherPopupOverlayTitle;
        this.SEARCH_DEFAULT        = options.switcherPopupStartSearch;
        if (this.SEARCH_DEFAULT)
            this._searchEntry = '';
        else
            this._searchEntry = null;
        this._monitorIndex         = global.display.get_current_monitor();
        this.SHOW_APPS    = false;

        // Window switcher
        this.WIN_FILTER_MODE       = options.winSwitcherPopupFilter;
        if ((Main.layoutManager.monitors.length < 2) && this.WIN_FILTER_MODE === FilterModes.MONITOR)
            this.WIN_FILTER_MODE   = FilterModes.WORKSPACE;
        this.GROUP_MODE            = options.winSwitcherPopupOrder;
        this._defaultGrouping      = this.GROUP_MODE; // remember default sorting
        this.WIN_SORTING_MODE      = options.winSwitcherPopupSorting;
        this.SKIP_MINIMIZED        = options.winSkipMinimized;
        this.SEARCH_APPS           = options.winSwitcherPopupSearchApps;
        this._initialSelectionMode = this.WIN_SORTING_MODE === SortingModes.STABLE_SEQUENCE ? SelectionModes.ACTIVE : SelectionModes.SECOND;
        this._singleAppPreviewSize = options.singleAppPreviewSize;
        WINDOW_PREVIEW_SIZE        = options.winSwitcherPopupPreviewSize;
        APP_ICON_SIZE              = options.winSwitcherPopupIconSize;
        WS_INDEXES                 = options.winSwitcherPopupWsIndexes;

        // App switcher
        this.APP_FILTER_MODE       = options.appSwitcherPopupFilter;
        if ((Main.layoutManager.monitors.length < 2) && this.APP_FILTER_MODE === FilterModes.MONITOR)
            this.APP_FILTER_MODE   = FilterModes.WORKSPACE;
        this.APP_SORTING_MODE      = options.appSwitcherPopupSorting;
        this.SORT_FAVORITES_BY_MRU = options.appSwitcherPopupFavMru;
        this.INCLUDE_FAVORITES     = options.appSwitcherPopupFavoriteApps;
        APP_MODE_ICON_SIZE    = options.appSwitcherPopupIconSize;

        this._switcherMode         = SwitcherModes.WINDOWS;

        // Runtime variables
        this._singleApp            = null;

        this._selectedIndex        = -1;    // deselect
        this._tempFilterMode       = null;
        this._firstRun             = true;
        this._favoritesMRU         = true;
        this._doNotReactOnScroll   = false;
        _cancelTimeout             = false;

        this._newWindowConnector   = global.display.connect_after('window-created', (w, win) => {
            if (this._doNotUpdateOnNewWindow)
                return;
            // there are situations when window list updates later than this callback is executed
            this._newWindowConnectorTimeoutId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                100,
                () => {
                    this._newWindowConnectorTimeoutId = 0;
                    this._updateSwitcher();
                    if (this._showingApps && this._selectedIndex > -1)
                        this._select(this._getItemIndexByID(_getWindowApp(win).get_id()));
                    else if (this._selectedIndex > -1)
                        this._select(this._getItemIndexByID(win.get_id()));

                    return GLib.SOURCE_REMOVE;
            });
        });

        this.connect('destroy', this._onDestroyThis.bind(this));
    }

    _onDestroyThis() {
        // _initialDelayTimeoutId was already removed in super class
        if (this._actions) {
            if (this._actions._wsOverlay) {
                this._actions.destroyWsOverlay();
            }
        }

        if (this._showWinImmediatelyTimeoutId)
            GLib.source_remove(this._showWinImmediatelyTimeoutId);
        if (this._newWindowConnectorTimeoutId)
            GLib.source_remove(this._newWindowConnectorTimeoutId);

        global.display.disconnect(this._newWindowConnector);
        this._actions = null;

        this._removeOverlays();
    }

    _removeOverlays() {
        if (this._overlayTitle) {
            this.destroyOverlayLabel(this._overlayTitle);
            this._overlayTitle = null;
        }
        if (this._overlaySearchLabel) {
            this.destroyOverlayLabel(this._overlaySearchLabel);
            this._overlaySearchLabel = null;
        }
        if (this._wsOverlay) {
            this.destroyOverlayLabel(this._wsOverlay);
            this._wsOverlay = null;
        }
    }

    vfunc_allocate(box, flags) {
        let monitor = this._getMonitorByIndex(this._monitorIndex);
        GNOME40 ?   this.set_allocation(box)
            :   this.set_allocation(box, flags);
        let childBox = new Clutter.ActorBox();
        // Allocate the switcherList
        // We select a size based on an icon size that does not overflow the screen
        let [, childNaturalHeight] = this._switcherList.get_preferred_height(monitor.width);
        let [, childNaturalWidth] = this._switcherList.get_preferred_width(childNaturalHeight);
        if (this.POSITION_POINTER && !this.KEYBOARD_TRIGGERED) {
            childBox.x1 = Math.min(this._pointer.x, monitor.x + monitor.width - childNaturalWidth);
            if (childBox.x1 < monitor.x)
                childBox.x1 = monitor.x;
            childBox.y1 = Math.min(this._pointer.y, monitor.height - childNaturalHeight);
        } else {
            childBox.x1 = Math.max(monitor.x, monitor.x + Math.floor((monitor.width - childNaturalWidth) / 2));
            let offset = Math.floor((monitor.height - childNaturalHeight) / 2);
            if (this.POPUP_POSITION === Positions.TOP)
                offset = 0;
            if (this.POPUP_POSITION === Positions.BOTTOM)
                offset = monitor.height - childNaturalHeight;
            childBox.y1 = monitor.y + offset;
        }
        childBox.x2 = Math.min(monitor.x + monitor.width, childBox.x1 + childNaturalWidth);
        childBox.y2 = childBox.y1 + childNaturalHeight;
        GNOME40 ?   this._switcherList.allocate(childBox)
            :   this._switcherList.allocate(childBox, flags);
    }

    _initialSelection(backward, binding) {
        if (this._searchEntry !== null && this._searchEntry !== '')
            this._initialSelectionMode = SelectionModes.FIRST;
        if (this._items.length === 1 && this._switcherList) {
            this._select(0);
        } else if (backward) {
            if (this._initialSelectionMode === SelectionModes.SECOND)
                this._select(this._items.length - 1);
            else if (this._initialSelectionMode === SelectionModes.ACTIVE)
                this._select(this._getFocusedItemIndex());
                // this._select(this._previous());
        } else if (this._initialSelectionMode === SelectionModes.FIRST) {
            this._select(0);
        } else if (this._initialSelectionMode === SelectionModes.SECOND) {
            if (this._items.length > 1)
                this._select(1);
            else
                this._select(0);
        } else if (this._initialSelectionMode === SelectionModes.ACTIVE) {
            this._select(this._getFocusedItemIndex());
            // this._select(this._next());
        }
    }

    show(backward, binding, mask) {
        // remove overlay labels if exist
        this._removeOverlays();

        if (!Main.pushModal(this)) {
            if (!Main.pushModal(this, {options: Meta.ModalOptions.POINTER_ALREADY_GRABBED}))
                return false;
        }

        if (binding == 'switch-group') {
            this._switchGroupInit = true;
            //this._doNotFinishBeforeUpdate = true;
            let id = null;
            let metaWin = global.display.get_tab_list(Meta.WindowType.NORMAL, null)[0];
            if (metaWin)
                id = _getWindowApp(metaWin).get_id();
            if (id) {
                this._singleApp = id;
                this.SHOW_APPS = false;
            }
        }

        showHotKeys = this.KEYBOARD_TRIGGERED;
        if (this._pointer == undefined) {
            this._pointer = [];
            [this._pointer.x, this._pointer.y] = global.get_pointer();
            this._haveModal = true;
        }

        if (this._tempFilterMode)
            this._tempFilterMode = null;

        let switcherItems;
        if (this.SHOW_APPS) {
            switcherItems = this._getAppList(this._searchEntry);
        } else {
            switcherItems = this._getCustomWindowList();
        }

        let filterSwitchAllowed = (this._searchEntry === null || this._searchEntry === '') ||
                                    (this.SEARCH_ALL && this._searchEntry !== null && this._searchEntry !== '');

        if (switcherItems.length === 0 && filterSwitchAllowed) {
            for (let mod = this.WIN_FILTER_MODE; mod > 0; mod--) {
                this._tempFilterMode = mod;
                switcherItems = this._getCustomWindowList();
                if (switcherItems.length > 0 && (this._searchEntry === null || this._searchEntry === '')) {
                    this._initialSelectionMode = SelectionModes.NONE;
                    this._selectedIndex = -1;
                    break;
                }
            }
            if (switcherItems.length === 0 && this._tempFilterMode && this._searchEntry !== null && this._searchEntry !== '' && this.SEARCH_APPS === false) {
                this._searchEntry = this._searchEntry.slice(0, -1);
                this._tempFilterMode = null;
                switcherItems = this._getCustomWindowList();
            }
        }

        if (switcherItems.length === 0 && this.SEARCH_APPS === true && this._searchEntry !== null && this._searchEntry !== '') {
            switcherItems = this._getAppList(this._searchEntry);

            this._initialSelectionMode = SelectionModes.FIRST;

            if (switcherItems.length === 0) {
                // no results -> back to the last successful
                this._searchEntry = this._searchEntry.slice(0, -1);

                if (this.SHOW_APPS) {
                    switcherItems = this._getAppList(this._searchEntry);
                }
                else {
                    switcherItems = this._getCustomWindowList();
                    // if app search for window switcher is enabled, we are not sure which list was the last successful
                    if (!switcherItems.length) {
                        switcherItems = this._getAppList(this._searchEntry);
                    }
                }
            }
        }

        if (!switcherItems.length && !AltTab.getWindows(null).length) {
            this.SWITCHER_MODE = SwitcherModes.APPS;
            this.INCLUDE_FAVORITES = true;
            this.SHOW_APPS = true;
            this._initialSelectionMode = SelectionModes.FIRST;
            switcherItems = this._getAppList();
        }

        if (switcherItems.length > 0) {
            if (this._switcherList)
                this._switcherList.destroy();
            this._switcherList = new WindowSwitcher(switcherItems);
            this._switcherList._parent = this;
            // if (this.OVERLAY_TITLE) {
            //     this._switcherList._label.hide();
            // }
            this._items = this._switcherList.icons;
            this._connectIcons();

            this.showOrig(backward, binding, mask);
        } else {
            return false;
        }
        this._tempFilterMode = null;
        return true;
    }

    showOrig(backward, binding, mask) {
        if (this._items.length == 0)
            return false;

        this._alreadyShowed = true;

        this._haveModal = true;

        this.add_actor(this._switcherList);
        this._switcherList.connect('item-activated', this._itemActivated.bind(this));
        this._switcherList.connect('item-entered', this._itemEntered.bind(this));
        this._switcherList.connect('item-removed', this._itemRemoved.bind(this));

        this.visible = true;
        this.opacity = 0;
        this.get_allocation_box();
        this._initialSelection(backward, binding);

        // There's a race condition; if the user released Alt before
        // we got the grab, then we won't be notified. (See
        // https://bugzilla.gnome.org/show_bug.cgi?id=596695 for
        // details.) So we check now. (Have to do this after updating
        // selection.)
        if (mask !== undefined)
            this._modifierMask = mask;
        if (this._modifierMask) {
            let mods = global.get_pointer()[2];
            if (!(mods & this._modifierMask)) {
                if (!this._firstRun) {
                    this._finish(global.get_current_time());
                    return true;
                }
            }
        } else {
            this._resetNoModsTimeout();
        }

        this._setSwitcherStatus();
        // avoid showing overlay label before the switcher popup
        if (this._firstRun && this._overlayTitle)
            this._overlayTitle.opacity = 0;

        // We delay showing the popup so that fast Alt+Tab users aren't
        // disturbed by the popup briefly flashing.
        // but not when we're just overriding already shown content
        if (this._firstRun) {
            // timeout in which click on the swhitcher background acts as 'activate' despite configuration
            // for quick switch to recent window when triggered using mouse and top/bottom popup position
            this._recentSwitchTimeoutId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                500,
                () => {
                    this._recentSwitchTimeoutId = 0;
                    return GLib.SOURCE_REMOVE
                }
            );

            this._initialDelayTimeoutId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                this.KEYBOARD_TRIGGERED ? this.INITIAL_DELAY : 0,
                () => {
                    if (!this._doNotShowImmediately) {
                        if (this.KEYBOARD_TRIGGERED) {
                            if (this._overlayTitle)
                                this._overlayTitle.opacity = 255;
                            this._showImmediately();
                        } else {
                            this._shadeIn();
                        }
                    }
                    this._initialDelayTimeoutId = 0;
                    return GLib.SOURCE_REMOVE;
                });
            GLib.Source.set_name_by_id(this._initialDelayTimeoutId, '[gnome-shell] Main.osdWindow.cancel');
        } else {
            this.opacity = 255;
            if (this._actions._wsOverlay)
                this._actions._wsOverlay.opacity = 255;
        }
        if (this._initialSelectionMode === SelectionModes.RECENT || this._initialSelectionMode === SelectionModes.NONE)
            this._initialSelectionMode = SelectionModes.ACTIVE;
        this._resetNoModsTimeout();
        Main.osdWindowManager.hideAll();

        if (this._searchEntry === '' && !this.SEARCH_DEFAULT)
            this._showOverlaySearchLabel('Type to search...');

        // if switcher switches the filter mode, color the popup border to indicate current filter - red for MONITOR, orange for WS
        if (!this._firstRun && !(this._showingApps && (this._searchEntry !== null && this._searchEntry !== ''))) {
            let fm = this._showingApps ? this.APP_FILTER_MODE : this.WIN_FILTER_MODE;
            fm = this._tempFilterMode ? this._tempFilterMode : fm;
            if (fm === FilterModes.MONITOR) {
                // top and bottom border colors cover all sides
                this._switcherList.set_style('border-top-color: rgb(96, 48, 48); border-bottom-color: rgb(96, 48, 48);');
            } else if (fm === FilterModes.WORKSPACE) {
                this._switcherList.set_style('border-top-color: rgb(96, 80, 48); border-bottom-color: rgb(96, 80, 48);');
            } else if (fm === FilterModes.ALL) {
                this._switcherList.set_style('border-top-color: rgb(53, 96, 48); border-bottom-color: rgb(53, 96, 48);');
            }
        }

        this._firstRun = false;
        return true;
    }

    _shadeIn() {
        let height = this._switcherList.height;
        this._switcherList.height = 0;
        this.opacity = 255;
        this._switcherList.ease({
            height,
            duration: 100,
            mode: Clutter.AnimationMode.LINEAR,
        });

        if (this._overlayTitle) {
            let ty;
            let geometry = global.display.get_monitor_geometry(this._monitorIndex);
            switch (this.POPUP_POSITION) {
            case Positions.TOP:
                ty = 0;
                break;
            case Positions.CENTER:
                ty = geometry.height / 2;
                break;
            case Positions.BOTTOM:
                ty = geometry.height;
                break;
            }

            let y = this._overlayTitle.y;
            this._overlayTitle.opacity = 255;
            this._overlayTitle.y = ty;
            this._overlayTitle.ease({
                y,
                duration: 100,
                mode: Clutter.AnimationMode.LINEAR,
            });
        }
    }

    _shadeOut() {
        this._switcherList.ease({
            height: 0,
            duration: 100,
            mode: Clutter.AnimationMode.LINEAR,
            onComplete: () => this.destroy(),
        });

        if (this._overlayTitle) {
            let geometry = global.display.get_monitor_geometry(this._monitorIndex);
            let y;
            switch (this.POPUP_POSITION) {
            case Positions.TOP:
                y = 0;
                break;
            case Positions.CENTER:
                y = geometry.height / 2;
                break;
            case Positions.BOTTOM:
                y = geometry.height;
                break;
            }

            this._overlayTitle.ease({
                y,
                duration: 100,
                mode: Clutter.AnimationMode.LINEAR,
            });
        }
    }

    fadeAndDestroy() {
        this._doNotShowImmediately = true;
        this._popModal();
        if (this.opacity > 0) {
            if (this.KEYBOARD_TRIGGERED) {
                this._switcherList.ease({
                    opacity: 0,
                    height: 0,
                    duration: 100,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    // mode: Clutter.AnimationMode.LINEAR,
                    onComplete: () => this.destroy(),
                });
            } else {
                this._shadeOut();
            }
        } else {
            this.destroy();
        }
    }

    _finish() {
        if (this._showWinImmediatelyTimeoutId) {
            GLib.source_remove(this._showWinImmediatelyTimeoutId);
            this._showWinImmediatelyTimeoutId = 0;
        }
        this._doNotShowWin = true;
        this._doNotUpdateOnNewWindow = true;
        if (this._showingApps) {
            if (_ctrlPressed()) {
                // this can cause problems when a shortcut with Ctrl key is used to trigger the popup
                // so allow this only when it's not the case
                if (!_ctrlPressed(this._modifierMask))
                    this._getSelected().open_new_window(global.get_current_time());
            } else if (this._getSelected().cachedWindows[0]) {
                // Main.activateWindow(this._getSelected().cachedWindows[0]);
                // following not only activates the app recent window, but also rise all other windows of the app above other windows
                this._getSelected().activate_window(this._getSelected().cachedWindows[0], global.get_current_time());
            } else {
                if (this._getSelected().get_n_windows() === 0) {
                    // app has no windows - probably not running
                    this._getSelected().activate();
                } else {
                    // in this case app is running but no window match the current filter mode
                    this._getSelected().open_new_window(global.get_current_time());
                }
            }
        } else {
            Main.activateWindow(this._getSelected());
        }
        super._finish();
    }

    _connectIcons() {
        this._switcherList.icons.forEach(icon => icon.connect('button-press-event', this._onItemBtnPressEvent.bind(this)));
        this._switcherList.icons.forEach(icon => icon.connect('scroll-event', this._onItemScrollEvent.bind(this)));
    }

    _onItemBtnPressEvent(actor, event) {
        const btn = event.get_button();
        let action;

        switch (btn) {
        case Clutter.BUTTON_PRIMARY:
            action = this._showingApps
            ? options.appSwitcherPopupPrimClickItem
            : options.winSwitcherPopupPrimClickItem;
            break;
        case Clutter.BUTTON_SECONDARY:
            action = this._showingApps
            ? options.appSwitcherPopupSecClickItem
            : options.winSwitcherPopupSecClickItem;
            break;
        case Clutter.BUTTON_MIDDLE:
            action = this._showingApps
            ? options.appSwitcherPopupMidClickItem
            : options.winSwitcherPopupMidClickItem;
            break;
        default:
            return Clutter.EVENT_PROPAGATE;
        }

        this._triggerAction(action);
        return Clutter.EVENT_STOP;
    }

    _onItemScrollEvent(actor, event) {
        let direction = event.get_scroll_direction();
        if (direction === Clutter.ScrollDirection.SMOOTH)
            return;
        if (this._showingApps) {
            this._triggerAction(options.appSwitcherPopupScrollItem, direction);

        } else { // if (this._switcherMode === SwitcherModes.WINDOWS) {
            this._triggerAction(options.winSwitcherPopupScrollItem, direction);
        }
        return Clutter.EVENT_STOP;
    }

    _triggerAction(action, direction = 0) {
        let obj;
        switch (action) {
        case Actions.SELECT_ITEM:
            this._disableHover();
            this._scrollHandler(direction);
            break;
        case Actions.SWITCH_FILTER:
            this._switchFilterMode();
            break;
        case Actions.SWITCH_WS:
            this._switchWorkspace(direction);
            break;
        case Actions.SHOW:
            this._showWindow(this._selectedIndex);
            break;
        case Actions.GROUP_APP:
            if (this.GROUP_MODE !== GroupModes.APPS) {
                this.GROUP_MODE = GroupModes.APPS;
                this.show();
            }
            break;
        case Actions.CURRENT_MON_FIRST:
            if (this.GROUP_MODE !== GroupModes.CURRENT_MON_FIRST) {
                this.GROUP_MODE = GroupModes.CURRENT_MON_FIRST;
                this.show();
            }
            break;
        case Actions.SINGLE_APP:
            this._toggleSingleAppMode();
            break;
        case Actions.SWITCHER_MODE:
            this._toggleSwitcherMode();
            break;
        case Actions.ACTIVATE:
            this._finish();
            break;
        case Actions.THUMBNAIL:
            obj = this._getSelected();
            if (obj && !obj.get_windows)
                this._actions.makeThumbnailWindow(obj);
            break;
        case Actions.MOVE_TO_WS:
            obj = this._getSelected();
            if (obj) {
                win = obj.cachedWindows ? obj.cachedWindows[0] : obj;
                this._actions.moveWindowToCurrentWs(win, this.KEYBOARD_TRIGGERED ? this._monitorIndex : -1);
                this._showWindow(this._selectedIndex);
                this._updateSwitcher();
            }
            break;
        case Actions.HIDE:
            this.fadeAndDestroy();
            break;
        case Actions.MENU:
            const appIcon = this._items[this._selectedIndex];
            if (appIcon)
                appIcon.popupMenu();
            break;
        case Actions.CLOSE_QUIT:
            if (this._showingApps) {
                this._getSelected().request_quit();
                this._delayedUpdate(200);
            } else if (_ctrlPressed()) {
                _getWindowApp(this._getSelected()).request_quit();
            } else {
                this._actions.closeWindow(this._getSelected());
            }
            break;
        case Actions.KILL:
            if (this._showingApps) {
                if (this._getSelected().cachedWindows.length > 0)
                    this._getSelected().cachedWindows[0].kill();
                this._delayedUpdate(100);
            } else {
                this._getSelected().kill();
            }
            break;
        case Actions.PREFS:
            Main.extensionManager.openExtensionPrefs(Me.metadata.uuid, '', {});
            break;
        case Actions.NEW_WINDOW:
            this._openNewWindow();
            break;
        case Actions.NOTHING:
            break;
        default:
            return Clutter.EVENT_PROPAGATE;
        }
    }

    _openNewWindow() {
        let obj = this._getSelected();
        if (obj) {
            if (this._showingApps) {
                obj.open_new_window(global.get_current_time());
            }
            else {
                obj = Shell.WindowTracker.get_default().get_window_app(obj);
                obj.open_new_window(global.get_current_time());
            }
        }
    }

    _updateSwitcher(winToApp = false) {
        let id;
        if (winToApp) {
            id = _getWindowApp(this._items[0].window);
        } else {
            id = this._getSelected();
        }
        id = id ? id.get_id() : null;
        this.show();
        this._select(this._getItemIndexByID(id));
    }

    /*_activateWinSwitchedApp(win) {
        if (this._getSelected().idx) {
            // scroll switched the app window, it needs to be activated now
            let app = this._getSelected();
            Main.activateWindow(app.cachedWindows[app.idx]);
        }
    }*/

    _setSwitcherStatus() {
        this._switcherList._statusLabel.set_text(
            `${_('Search: ')} ${this._searchEntry === null ? 'Off' : 'On'}, ${
                _('Filter: ')}${FilterModeLabels[this._tempFilterMode === null ? this.WIN_FILTER_MODE : this._tempFilterMode]
            }${this._singleApp ? `/${_('APP')}` : ''},  ${
                _('Group: ')}${GroupModeLabels[this.GROUP_MODE]}, ${
                _('Sort: ')}${this._showingApps ? SortingModesLabels[this.APP_SORTING_MODE] : SortingModesLabels[this.WIN_SORTING_MODE]}`
        );
        if (this._searchEntry !== null && this._searchEntry !== '') {
            this._showOverlaySearchLabel(this._searchEntry);
        } else if (this._searchEntry === '' && this._overlaySearchLabel) {
            this.destroyOverlayLabel(this._overlaySearchLabel);
            this._overlaySearchLabel = null;
        }
    }

    // place the indicator overlay outside the switcher
    _showWsIndex(text = null, size = 0) {
        if (!this.SHOW_WS_INDEX && !text)
            return;

        const offset = (this._overlayTitle ? this._overlayTitle.height : 0)
                     + (this._overlaySearchLabel ? this._overlaySearchLabel.height : 0);

        if (this._wsOverlay) {
            this.destroyOverlayLabel(this._wsOverlay);
        }

        //let wsLabel = this._actions.showWorkspaceIndex([], 1000, this._monitorIndex);
        this._wsOverlay = this._customOverlayLabel('ws-overlay', 'workspace-index-overlay');
        this._wsOverlay.text = (global.workspace_manager.get_active_workspace().index() + 1).toString();
        Main.layoutManager.addChrome(this._wsOverlay);

        let geometry = global.display.get_monitor_geometry(this._monitorIndex);
        let l1 = this._overlayTitle ? (this._overlayTitle.height + 10) : 0;
        let l2 = this._overlaySearchLabel ? (this._overlaySearchLabel.height + 10) : 0;
        switch (this.POPUP_POSITION) {
        case Positions.TOP:
            this._wsOverlay.y = Math.max(
                geometry.height / 2,
                Math.min(geometry.height - this._wsOverlay.height - this._switcherList.height - l1 - l2, geometry.height)
            );
            break;
        case Positions.CENTER:
            this._wsOverlay.y = Math.min(
                geometry.height / 2 + (this._switcherList.height / 2),
                Math.max(geometry.height / 2 + this._wsOverlay.height / 2, geometry.height)
            );
            break;
        case Positions.BOTTOM :
            this._wsOverlay.y = Math.min(
                geometry.height / 2,
                Math.max(geometry.height - this._wsOverlay.height - this._switcherList.height - l1 - l2, 0)
            );
            break;
        }
        this._wsOverlay.x = geometry.x;
        this._wsOverlay.width = geometry.width;
        //return wsLabel;
    }

    _showOverlaySearchLabel(text) {
        if (this._overlaySearchLabel) {
            this.destroyOverlayLabel(this._overlaySearchLabel);
        }
        this._overlaySearchLabel = new St.BoxLayout({style_class: 'search-text'});

        let icon = new St.Icon({icon_name: 'edit-find-symbolic'});
        this._overlaySearchLabel.add_actor(icon);
        this._overlaySearchLabel._label = this._customOverlayLabel('search-text', '');
        this._overlaySearchLabel._label.text = ` ${text}`;

        this._overlaySearchLabel.add_actor(this._overlaySearchLabel._label);
        Main.layoutManager.addChrome(this._overlaySearchLabel);
        const offset = this._overlayTitle
            ? this._overlayTitle.height + 10
            : 10;
        this._setOverlayLabelPosition(this._overlaySearchLabel, offset);
    }
    
    _showOverlayTitle(index) {
        let selected = this._items[this._selectedIndex];
        let title = '';
        title = selected.is_window
            ? selected.window.get_title()
            : selected.ilabel.text;
        if (this._overlayTitle) {
            this.destroyOverlayLabel(this._overlayTitle);
        }

        this._searchBox = new St.BoxLayout();

        this._overlayTitle = this._customOverlayLabel('item-title', 'title-label');
        this._overlayTitle.text = title;
        Main.layoutManager.addChrome(this._overlayTitle);
        this._setOverlayLabelPosition(this._overlayTitle);
    }

    _setOverlayLabelPosition(overlayLabel, offset = 0) {
        let geometry = global.display.get_monitor_geometry(this._monitorIndex);
        overlayLabel.width = Math.min(overlayLabel.width, geometry.width);
        overlayLabel.x = geometry.x + Math.floor(geometry.width / 2) - Math.floor(overlayLabel.width / 2);
        switch (this.POPUP_POSITION) {
        case Positions.TOP:
            overlayLabel.y = Math.floor(this._switcherList.height + 10 + offset);
            break;
        case Positions.CENTER:
            overlayLabel.y = Math.floor((geometry.height - this._switcherList.height) / 2 - overlayLabel.height - 10) - offset;
            break;
        case Positions.BOTTOM:
            overlayLabel.y = Math.floor(geometry.height - this._switcherList.height - overlayLabel.height - 10) - offset;
            break;
        }
    }

    _customOverlayLabel(name, style_class) {
        let label = new St.Label({
            name: name,
            style_class: style_class,
            reactive: false,
        });
        return label;
    }

    destroyOverlayLabel(overlayLabel) {
        Main.layoutManager.removeChrome(overlayLabel);
        overlayLabel.destroy();
    }

    _resetNoModsTimeout() {
        if (this._noModsTimeoutId)
            GLib.source_remove(this._noModsTimeoutId);
        this._noModsTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            this.NO_MODS_TIMEOUT,
            () => {
                if (!this.KEYBOARD_TRIGGERED && this._isPointerOut() && !_cancelTimeout) {
                    if (this.SHOW_WIN_IMEDIATELY) {
                        if (this._lastShowed)
                            this._selectedIndex = this._lastShowed;
                        if (this._showingApps) {
                            if (this._getSelected().cachedWindows.length) {
                                this._finish();
                            } else {
                                this.fadeAndDestroy();
                            }
                        } else {
                            this._finish();
                        }

                    } else if (this.ACTIVATE_ON_HIDE) {
                        this._finish();
                    } else {
                        this.fadeAndDestroy();
                    }

                    this._noModsTimeoutId = 0;
                    return GLib.SOURCE_REMOVE;
                } else {
                    this._noModsTimeoutId = 0;
                    this._resetNoModsTimeout();
                }
            }
        );
    }

    _getFocusedItemIndex() {
        const metaWin = global.display.get_tab_list(Meta.TabList.NORMAL, null)[0];
        if (!metaWin)
            return 0;

        let id;
        let pt;

        if (this._items[0].is_window) {
            id = metaWin.get_id();
            pt = 'window';
        } else {
            id = _getWindowApp(metaWin).get_id();
            pt = 'app';
        }
        for (let i = 0; i < this._items.length; i++) {
            if (this._items[i][pt].get_id() === id)
                return i;
        }

        return 0;
    }

    _getSelectedID() {
        let item = this._items[this._selectedIndex > -1 ? this._selectedIndex : 0];

        if (item.window)
            return item.window.get_id();
        else
            return item.app.get_id();
    }

    _select(index) {
        if (!this._switcherList)
            return;

        if (this._initialSelectionMode === SelectionModes.NONE) {
            this._initialSelectionMode = SelectionModes.ACTIVE;
        } else {
            this._selectedIndex = index;
            this._switcherList.highlight(index);
            if (this.OVERLAY_TITLE)
                this._showOverlayTitle(index);
        }

        if (this.SHOW_WIN_IMEDIATELY) {
            if (this._showWinImmediatelyTimeoutId) {
                GLib.source_remove(this._showWinImmediatelyTimeoutId);
                this._showWinImmediatelyTimeoutId = 0;
            }

            if (!this._doNotShowWin) {
                this._showWinImmediatelyTimeoutId = GLib.timeout_add(
                    GLib.PRIORITY_DEFAULT,
                    100,
                    () => {
                        if (this.KEYBOARD_TRIGGERED || (!this.KEYBOARD_TRIGGERED && !this._isPointerOut())) {
                            this._showWindow(this._selectedIndex);
                            this._lastShowed = this._selectedIndex;
                        }

                        this._showWinImmediatelyTimeoutId = 0;

                        return GLib.SOURCE_REMOVE;
                    }
                );
            }

            return;
        }

        this._resetNoModsTimeout();
    }

    _next() {
        let step = 1;
        if (!this.WRAPAROUND && this._selectedIndex === (this._items.length - 1))
            step = 0;

        return mod(this._selectedIndex + step, this._items.length);
    }

    _previous() {
        let step = 1;
        if (!this.WRAPAROUND && this._selectedIndex === 0)
            step = 0;

        return mod(this._selectedIndex - step, this._items.length);
    }

    _selectNextApp(selectedIndex) {
        let lastIndex, step;
        if (_shiftPressed()) {
            lastIndex = 0;
            step = -1;
        } else {
            lastIndex = this._items.length - 1;
            step = 1;
        }

        let secondRun = false;
        let winApp = _getWindowApp(this._items[selectedIndex].window).get_id();
        let nextApp = null;
        for (let i = selectedIndex; i !== lastIndex + step; i += step) {
            if (_getWindowApp(this._items[i].window).get_id() !== winApp) {
                if (!_shiftPressed()) {
                    this._select(i);
                    return;
                } else {
                    // find the first window of the group
                    if (!nextApp)
                        nextApp = _getWindowApp(this._items[i].window).get_id();

                    if (_getWindowApp(this._items[i].window).get_id() != nextApp || i == lastIndex) {
                        this._select(i + (i == 0 ? 0 : 1));
                        return;
                    }
                }
            }
            // if no other app found try again from start
            if (i === lastIndex && !secondRun) {
                step === 1 ? i = -1 : i = this._items.length;
                secondRun = true;
            }
        }
    }

    _getNextApp(list) {
        // let apps = _getAppList(list);
        let apps = _getRunningAppsIds();
        if (apps.length === 0)
            return;
        let currentIndex = apps.indexOf(this._singleApp);
        if (currentIndex < 0)
            return;

        let targetIndex;
        if (_shiftPressed()) {
            targetIndex = currentIndex + 1;
            if (targetIndex > (apps.length - 1))
                targetIndex = 0;
        } else {
            targetIndex = currentIndex - 1;
            if (targetIndex < 0)
                targetIndex = apps.length - 1;
        }

        return apps[targetIndex];
    }

    _switchFilterMode() {
        let filterMode = this._showingApps
            ? this.APP_FILTER_MODE
            : this.WIN_FILTER_MODE;
        // if active ws has all windows on one monitor, ignore the monitor filter mode to avoid 'nothing happen' when switching between modes
        let m = (Main.layoutManager.monitors.length > 1) && !this._allWSWindowsSameMonitor() ? 3 : 2;
        filterMode -= 1;
        if (filterMode < FilterModes.ALL)
            filterMode = m;

        this.APP_FILTER_MODE = filterMode;
        this.WIN_FILTER_MODE = filterMode;

        this.show();
    }

    _allWSWindowsSameMonitor() {
        let currentMonitor = global.display.get_current_monitor();
        let currentWS = global.workspace_manager.get_active_workspace();
        let windows = AltTab.getWindows(currentWS);
        if (windows.length === 0)
            return null;
        let ri = windows[0].get_monitor();
        for (let w of windows) {
            if (w.get_monitor() !== ri)
                return false;
        }

        return true;
    }

    _getSelected() {
        let obj = null;
        if (this._selectedIndex > -1) {
            let it = this._items[this._selectedIndex];
            if (it.is_window)
                obj = this._items[this._selectedIndex].window;
            else
                obj = this._items[this._selectedIndex].app;
        }
        return obj;
    }

    _getItemIndexByID(id) {
        let index = 0;
        for (let i = 0; i < this._items.length; i++) {
            let pt  = this._items[i].is_window ? 'window' : 'app';
            let cid = this._items[i][pt].get_id();

            if (cid === id) {
                index = i;
                break;
            }
        }

        return index;
    }

    _isPointerOut() {
        let [x, y, mods] = global.get_pointer();
        let switcher = this._switcherList;
        let margin = 15;

        if (x < (switcher.x - margin) || x > (switcher.x + switcher.width + margin))
            return true;
        if (y < (switcher.y - margin) || y > (switcher.y + switcher.height + margin))
            return true;

        return false;
    }

    _getMonitorByIndex(monitorIndex) {
        let monitors = Main.layoutManager.monitors;
        for (let monitor of monitors) {
            if (monitor.index === monitorIndex)
                return monitor;
        }
        return -1;
    }

    _delayedUpdate(delay) {
        GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            delay,
            () => {
                this._updateSwitcher();
            }
        );
    }

    _match(string, pattern) {
        // remove diacritics and accents from letters
        let s = string.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        let p = pattern.toLowerCase();
        let ps = p.split(/ +/);

        // allows to use multiple exact paterns separated by space in arbitrary order
        for (let w of ps) {
            if (!s.match(w))
                return false;
        }

        return true;
    }

    _switchWorkspace(direction) {
        let id = this._getSelectedID();
        this._actions.switchWorkspace(direction, true);
        this.show();

        if (this._selectedIndex > -1) {
            this._doNotShowWin = true;
            this._select(this._getItemIndexByID(id));
            this._doNotShowWin = false;
        }

        this._showWsIndex();
    }

    _switchMonitor(direction) {
        let display = global.display;
        let nMonitors = display.get_n_monitors();

        if (nMonitors > 1 && this._monitorIndex >= 0) {
            let monIdx = display.get_monitor_neighbor_index(this._monitorIndex, direction);

            if (monIdx > -1) {
                this._monitorIndex = monIdx;
                this._actions.destroyWsOverlay();
                this._updateSwitcher();
            }
        }
    }

    _toggleSingleAppMode(switchOn = false) {
        if (this._selectedIndex < 0)
            return;

        if (!this._singleApp || switchOn) {
            if (this._showingApps) {
                if (!this._getSelected().cachedWindows.length)
                    return;
                this._singleApp = this._getSelected().get_id();
                this.SHOW_APPS = false;
                // this._showingApps = false;
            } else {
                this._singleApp = _getWindowApp(this._getSelected()).get_id();
            }
        } else {
            this._singleApp = null;
            if (this._switcherMode === SwitcherModes.APPS) {
                this.SHOW_APPS = true;
                this._updateSwitcher(true);
                return;
            }
        }

        this._updateSwitcher();
    }

    _toggleSearchMode() {
        if (this._searchEntry !== null) {
            this._searchEntry = null;
            _cancelTimeout = false;
        } else {
            this._searchEntry = '';
            this._modifierMask = 0;
            _cancelTimeout = true;
            this.SEARCH_DEFAULT = false;
        }

        this.show();
    }

    _showWindow(_selectedIndex) {
        if (this._doNotShowWin)
            return;

        let item = this._getSelected();
        let appId = 0;

        if (item.get_windows) {
            appId = item.get_id();
            if (!item.cachedWindows.length)
                return;
            item = item.cachedWindows[0];
        }

        let id = item.get_id();
        if (appId)
            id = appId;

        let a = item.above;
        item.make_above();
        a ? item.make_above() : item.unmake_above();
        Main.wm.actionMoveWorkspace(item.get_workspace());
        this._showWsIndex();

        // avoid colision of creating new switcher while destroying popup during the initial show delay, when immediate show win is enabled
        if (!this._initialDelayTimeoutId)
            this.show();

        this._doNotShowWin = true;
        this._select(this._getItemIndexByID(id));
        this._doNotShowWin = false;
    }

    _toggleSwitcherMode() {
        if (this._switcherMode === SwitcherModes.APPS) {
            this._switcherMode = SwitcherModes.WINDOWS;
            this.SHOW_APPS = false;
            this._singleApp = null;

            let id = 0;
            if (this._showingApps) {
                if (this._getSelected().cachedWindows.length)
                    id = this._getSelected().cachedWindows[0].get_id();
            } else {
                id = _getWindowApp(this._items[0].window).get_id();
            }

            this.show();
            this._select(this._getItemIndexByID(id));
        } else /* if (this._switcherMode === SwitcherModes.WINDOWS)*/ {
            this._switcherMode = SwitcherModes.APPS;
            this.SHOW_APPS = true;
            this._singleApp = null;
            /* if (_searchEntry != null)
                this._searchEntry = '';*/

            let id;
            if (this._showingApps) {
                if (this._getSelected().cachedWindows.length)
                    id = this._getSelected().cachedWindows[0].get_id();
            } else {
                id = _getWindowApp(this._items[this._selectedIndex].window).get_id();
            }
            this._initialSelectionMode = SelectionModes.FIRST;
            this.show();
            this._select(this._getItemIndexByID(id));
        }
    }

    _toggleWsOrder() {
        if (this.GROUP_MODE === GroupModes.WORKSPACES)
            this.GROUP_MODE = this._defaultGrouping;
        else
            this.GROUP_MODE = GroupModes.WORKSPACES;
        this._updateSwitcher();
        this._showWsIndex();
    }

    /* _showApps() {
        this._switcherMode = SwitcherModes.APPS;
        this.SHOW_APPS = !this.SHOW_APPS;
        this._initialSelectionMode = SelectionModes.FIRST;
        this.show();
    }*/

    _moveFavotites(direction) {
        if (!this._showingApps && this.INCLUDE_FAVORITES)
            return;

        let app = this._getSelected().get_id();
        let favorites = global.settings.get_strv('favorite-apps');
        let fromIndex = favorites.indexOf(app);
        let maxIndex = favorites.length - 1;

        if (fromIndex == -1) {} else {
            // disable MRU sorting of favorites to see the result of the icon movement
            if (this._favoritesMRU) {
                this._favoritesMRU = false;
                this._updateSwitcher();
            } else {
                let toIndex = fromIndex + direction;
                if (toIndex < 0)
                    toIndex = maxIndex;
                else if (toIndex > maxIndex)
                    toIndex = 0;

                let element = favorites[fromIndex];
                favorites.splice(fromIndex, 1);
                favorites.splice(toIndex, 0, element);

                global.settings.set_strv('favorite-apps', favorites);
                this._updateSwitcher();
            }
        }
    }

    vfunc_key_press_event(keyEvent) {
        let keysym = keyEvent.keyval;
        // the action is an integer which is bind to the registered shortcut
        // but custom shortcuts are not stable
        let action = global.display.get_keybinding_action(
            keyEvent.hardware_keycode, keyEvent.modifier_state);
        this._disableHover();
        if (this._keyPressHandler(keysym, action) != Clutter.EVENT_PROPAGATE) {
            this._showImmediately();
            return Clutter.EVENT_STOP;
        }

        // Note: pressing one of the below keys will destroy the popup only if
        // that key is not used by the active popup's keyboard shortcut
        if (keysym === Clutter.KEY_Escape || keysym === Clutter.KEY_Tab)
            this.fadeAndDestroy();

        // Allow to explicitly select the current item; this is particularly
        // useful for no-modifier popups
        if (keysym === Clutter.KEY_space ||
            keysym === Clutter.KEY_Return ||
            keysym === Clutter.KEY_KP_Enter ||
            keysym === Clutter.KEY_ISO_Enter)
            this._finish(keyEvent.time);

        return Clutter.EVENT_STOP;
    }

    vfunc_key_release_event(keyEvent) {
        // monitor relase of possible shortcut modifier keys only
        if (!(keyEvent.keyval == 65513 || keyEvent.keyval == 65511 || // Alt and Alt while Shift pressed
               keyEvent.keyval == 65515 ||                             // Super
               keyEvent.keyval == 65507 || keyEvent.keyval == 65508 || // Ctrl
               keyEvent.keyval == 65505 || keyEvent.keyval == 65506 // Shift
        ))
            return;

        if (this._modifierMask) {
            let mods = global.get_pointer()[2];
            let state = mods & this._modifierMask;

            if (state === 0) {
                if (this._selectedIndex !== -1) {
                    this.blockSwitchWsFunction = true;
                    this._finish(keyEvent.time);
                } else {
                    this.fadeAndDestroy();
                }
            }
        } else {
            this._resetNoModsTimeout();
        }

        return Clutter.EVENT_STOP;
    }

    _keyPressHandler(keysym, action) {
        let keysymName = Gdk.keyval_name(keysym);

        if (keysymName.match(/F[1-9][0-2]?/) || (keysymName.match(/KP_[1-9]/) && this._searchEntry === null)) {
            let index;
            if (keysymName.startsWith('KP_'))
                index = parseInt(keysymName.substring(3)) - 1;
            else
                index = parseInt(keysymName.substring(1)) - 1;
            if (index < this._items.length) {
                this._selectedIndex = index;
                if (!_shiftPressed())
                    this._finish();
                else
                    this._select(index);
            }
        } else if (this._searchEntry !== null && (!_shiftPressed() || keysymName.replace('KP_', '').match(/[0-9]/))) {
            keysymName = keysymName.replace('KP_', '');

            // don't close the popup during typing, when not triggered by a keyboard
            _cancelTimeout = true;

            if (keysym === Clutter.KEY_BackSpace) {
                this._searchEntry = this._searchEntry.slice(0, -1);
                this.show();
                return Clutter.EVENT_STOP;
            } else if (this._searchEntry !== null && !_ctrlPressed() &&
                        ((keysymName.length === 1 && (/[a-zA-Z0-9]/).test(keysymName)) || keysym === Clutter.KEY_space)
            ) {
                if (keysymName === 'space')
                    keysymName = ' ';
                if (!(keysymName === ' ' && this._searchEntry === '')) {
                    this._searchEntry += keysymName;
                    this.show();
                    return Clutter.EVENT_STOP;
                }
            }
        }

        if (keysym === Clutter.KEY_Escape && this._singleApp && !this.KEYBOARD_TRIGGERED) {
            this._toggleSingleAppMode();
        } else if  (
            action == Meta.KeyBindingAction.SWITCH_WINDOWS ||
            action == Meta.KeyBindingAction.SWITCH_APPLICATIONS ||
            action == Meta.KeyBindingAction.SWITCH_WINDOWS_BACKWARD ||
            action == Meta.KeyBindingAction.SWITCH_APPLICATIONS_BACKWARD ||
            (this._keyBind &&
                (keysym == Clutter[`KEY_${this._keyBind.toUpperCase()}`] ||
                 keysym == Clutter[`KEY_${this._keyBind.toLowerCase()}`]
                )
            )
        ) {
            if (this._singleApp)
                this._toggleSingleAppMode();

            else if (_shiftPressed())
                this._select(this._previous());

            else
                this._select(this._next());
        } else if (keysym == Clutter.KEY_Tab && _ctrlPressed()) {
            let mod = Main.layoutManager.monitors.length;

            if (_shiftPressed())
                this._monitorIndex = (this._monitorIndex + mod) % mod;

            else
                this._monitorIndex = (this._monitorIndex + 1) % mod;

            this._actions.destroyWsOverlay();
            this._updateSwitcher();
        } else if (keysym == Clutter.KEY_e || keysym == Clutter.KEY_E || keysym == Clutter.KEY_Insert) {
            this._toggleSearchMode();
        }

        // Clear search entry or Force close (kill -9) the window process
        else if (keysym === Clutter.KEY_Delete) {
            if (this._selectedIndex < 0)
                return;

            if (!_shiftPressed() && this._searchEntry !== null) {
                this._searchEntry = '';
                this.show();
            } else if (_shiftPressed()) {
                if (this._showingApps) {
                    if (this._getSelected().cachedWindows.length > 0)
                        this._getSelected().cachedWindows[0].kill();
                    this._delayedUpdate(100);
                } else {
                    this._getSelected().kill();
                }
            }
        }

        // implement VIM text navigation keys hjkl
        else if (keysym == Clutter.KEY_Left || keysym == Clutter.KEY_h || keysym == Clutter.KEY_H) {
            if (_shiftPressed() && _ctrlPressed())
                this._moveFavotites(-1);
            else if (!_shiftPressed())
                this._select(this._previous());
            else
                this._switchMonitor(Meta.DisplayDirection.LEFT);
        } else if (keysym == Clutter.KEY_Right || keysym == Clutter.KEY_l || keysym == Clutter.KEY_L) {
            if (_shiftPressed() && _ctrlPressed())
                this._moveFavotites(+1);
            if (!_shiftPressed())
                this._select(this._next());
            else
                this._switchMonitor(Meta.DisplayDirection.RIGHT);
        } else if (keysym == Clutter.KEY_Up || keysym == Clutter.KEY_Page_Up || keysym == Clutter.KEY_k || keysym == Clutter.KEY_K) {
            if (!_shiftPressed())
                this._switchWorkspace(Clutter.ScrollDirection.UP);
            else
                this._switchMonitor(Meta.DisplayDirection.UP);
        } else if (keysym == Clutter.KEY_Down || keysym == Clutter.KEY_Page_Down || keysym == Clutter.KEY_j || keysym == Clutter.KEY_J) {
            if (!_shiftPressed())
                this._switchWorkspace(Clutter.ScrollDirection.DOWN);
            else
                this._switchMonitor(Meta.DisplayDirection.DOWN);
        } else if ((keysym === Clutter.KEY_y || keysym === Clutter.KEY_Y || keysym === Clutter.KEY_z || keysym === Clutter.KEY_Z) && (SHIFT_AZ_HOTKEYS ? _shiftPressed() : true)) {
            this._monitorIndex = (this._monitorIndex + 1) % Main.layoutManager.monitors.length;
            this._updateSwitcher();
        } else if (keysym === Clutter.KEY_Home) {
            if (_shiftPressed()) {
                Main.wm.actionMoveWorkspace(global.workspace_manager.get_workspace_by_index(0));
                this.show();
                this._showWsIndex();
            } else {
                this._select(0);
            }
        } else if (keysym === Clutter.KEY_End) {
            if (_shiftPressed()) {
                Main.wm.actionMoveWorkspace(global.workspace_manager.get_workspace_by_index(global.workspace_manager.n_workspaces - 1));
                this.show();
                this._showWsIndex();
            } else {
                this._select(this._items.length - 1);
            }
        } else if (keysym === Clutter.KEY_q || keysym === Clutter.KEY_Q) {
            this._switchFilterMode();
        } else if (keysym === Clutter.KEY_plus || keysym === Clutter.KEY_1 || keysym === Clutter.KEY_exclam) {
            if (this._selectedIndex < 0)
                return;
            this._toggleSingleAppMode();
        }

        // else if (keysym === Clutter.KEY_semicolon || keysym === 96 || keysym === 126 || keysym === 65112) { // 96 is grave, 126 ascii tilde, 65112 dead_abovering. I didn't find Clutter constants.
        else if (action == Meta.KeyBindingAction.SWITCH_GROUP || action == Meta.KeyBindingAction.SWITCH_GROUP_BACKWARD ||
                keysym === Clutter.KEY_semicolon || keysym === 96 || keysym === 126 || keysym === 65112) {
            if (_ctrlPressed()) {
                this._toggleSwitcherMode();
            } else { // Ctrl not pressed
                if (this._switcherMode === SwitcherModes.APPS) {
                    if (this._showingApps) {
                        if (this._getSelected().cachedWindows.length)
                            this._toggleSingleAppMode();
                    } else if (this._singleApp) {
                        if (_shiftPressed())
                            this._select(this._previous());

                        else
                            this._select(this._next());
                    } else {
                        this._toggleSwitcherMode();
                    }
                } else if (this._switcherMode === SwitcherModes.WINDOWS) {
                    let index = this._selectedIndex > -1 ? this._selectedIndex : 0;

                    if (this._singleApp) {
                        // when app filter is active, jump selection at the beginning of the next app group
                        this._switchNextApp = true;
                        this._initialSelectionMode = SelectionModes.FIRST;
                        this.show();
                    } else if (this.GROUP_MODE !== GroupModes.APPS) {
                        this.GROUP_MODE = GroupModes.APPS;
                        this.show();
                    }
                    if (!this._singleApp)
                        this._selectNextApp(index);
                }
            }
        }

        // toggle sort by workspaces
        else if ((keysym === Clutter.KEY_g || keysym === Clutter.KEY_G) && (SHIFT_AZ_HOTKEYS ? _shiftPressed() : true)) {
            if (this._showingApps)
                return;
            this._toggleWsOrder();
        }

        // show window
        else if (keysym === Clutter.KEY_space || keysym === Clutter.KEY_KP_0 || keysym === Clutter.KEY_KP_Insert) {
            //if (this._showingApps)
            //    return;
            this._showWindow(this._selectedIndex);
        }

        // close window/app
        else if (keysym === Clutter.KEY_w || keysym === Clutter.KEY_W) {
            if (this._showingApps && (SHIFT_AZ_HOTKEYS ? _shiftPressed() : true)) {
                this._getSelected().request_quit();
                this._delayedUpdate(200);
            } else if (_ctrlPressed()) {
                _getWindowApp(this._getSelected()).request_quit();
            } else if (SHIFT_AZ_HOTKEYS ? _shiftPressed() : true) {
                this._actions.closeWindow(this._getSelected());
            }
        }

        // close all windows of the same class displayed in selector
        else if ((keysym === Clutter.KEY_c || keysym === Clutter.KEY_C) && (SHIFT_AZ_HOTKEYS ? _shiftPressed() : true)) {
            if (this._showingApps)
                return;
            if (this._selectedIndex < 0)
                return;
            this._actions.closeWinsOfSameApp(this._getSelected(), this._items);
        }

        // quit application
        else if ((keysym === Clutter.KEY_d || keysym === Clutter.KEY_D) && (SHIFT_AZ_HOTKEYS ? _shiftPressed() : true)) {
            if (this._selectedIndex < 0)
                return;

            if (this._showingApps) {
                this._getSelected().request_quit();
                this._delayedUpdate(100);
            } else {
                _getWindowApp(this._getSelected()).request_quit();
            }
        }

        // make selected window Always on Top
        else if ((keysym === Clutter.KEY_a || keysym === Clutter.KEY_A) && (SHIFT_AZ_HOTKEYS ? _shiftPressed() : true)) {
            if (this._showingApps)
                return;

            if (this._selectedIndex < 0)
                return;
            this._actions.toggleAboveWindow(this._getSelected());
            let win = this._getSelected();
            Main.wm.actionMoveWorkspace(win.get_workspace());
            this._updateSwitcher();
        }

        // make selected window Allways on Visible Workspace
        else if ((keysym === Clutter.KEY_s || keysym === Clutter.KEY_S) && (SHIFT_AZ_HOTKEYS ? _shiftPressed() : true)) {
            if (this._showingApps)
                return;

            if (this._selectedIndex < 0)
                return;
            this._actions.toggleStickWindow(this._getSelected());
            this._updateSwitcher();
        }

        // toggle maximize
        else if ((keysym === Clutter.KEY_m || keysym === Clutter.KEY_M) && (SHIFT_AZ_HOTKEYS ? _shiftPressed() : true)) {
            if (this._showingApps)
                return;
            if (this._selectedIndex < 0)
                return;

            let win = this._getSelected();
            this._actions.toggleMaximizeWindow(win);
            this._updateSwitcher();
        }

        // move selected window to current workspace
        else if ((keysym === Clutter.KEY_x || keysym === Clutter.KEY_X) &&
                     (SHIFT_AZ_HOTKEYS ? _shiftPressed() : true)) {
            if (this._showingApps)
                return;

            let win = this._getSelected();
            if (!win)
                return;

            this._actions.moveWindowToCurrentWs(win, this.KEYBOARD_TRIGGERED ? this._monitorIndex : -1);
            this._showWindow(this._selectedIndex);
            this._updateSwitcher();
        }

        // move selected window to current workspace and maximize
        else if ((keysym === Clutter.KEY_v || keysym === Clutter.KEY_V) &&
                     (SHIFT_AZ_HOTKEYS ? _shiftPressed() : true)) {
            if (this._showingApps)
                return;

            if (this._getSelected()) {
                let win = this._getSelected();
                this._actions.moveWindowToCurrentWs(win);
                win.maximize(Meta.MaximizeFlags.BOTH);
                this._showWindow();
                this._updateSwitcher();
            }

        } else if ((keysym === Clutter.KEY_f || keysym === Clutter.KEY_F) &&
                    (SHIFT_AZ_HOTKEYS ? _shiftPressed() : true)) {
            if (this._showingApps)
                return;
            if (this._selectedIndex < 0)
                return;

            let win = this._getSelected();
            this._actions.fullscreenWinOnEmptyWs(win);
            this._updateSwitcher();

        } else if (((keysym === Clutter.KEY_n || keysym === Clutter.KEY_N) &&
                    (SHIFT_AZ_HOTKEYS ? _shiftPressed() : true)) ||
                    (keysym === Clutter.KEY_Return && _ctrlPressed())) {
            if (this._selectedIndex < 0)
                return;
            this._openNewWindow();

        } else if ((keysym === Clutter.KEY_o || keysym === Clutter.KEY_O) &&
                     (SHIFT_AZ_HOTKEYS ? _shiftPressed() : true)) {
            this._toggleSwitcherMode();
        }

        // make thumbnail of selected window
        else if ((keysym === Clutter.KEY_t || keysym === Clutter.KEY_T) && (SHIFT_AZ_HOTKEYS ? _shiftPressed() : true)) {
            if (this._showingApps)
                return;

            this._actions.makeThumbnailWindow(this._getSelected());

        } else if ((keysym === Clutter.KEY_p || keysym === Clutter.KEY_P) && (SHIFT_AZ_HOTKEYS ? _shiftPressed() : true)) {
            Main.extensionManager.openExtensionPrefs(Me.metadata.uuid, '', {});

        } else {
            return Clutter.EVENT_PROPAGATE;
        }

        return Clutter.EVENT_STOP;
    }

    vfunc_button_press_event(event) {
        const btn = event.button;
        const pointerOut = this._isPointerOut();
        let action;

        switch (btn) {
        case Clutter.BUTTON_PRIMARY:
            if (this._recentSwitchTimeoutId && !pointerOut)
                action = Actions.ACTIVATE;
            else
                action = pointerOut
                ? options.switcherPopupPrimClickOut
                : options.switcherPopupPrimClickIn;
            break;
        case Clutter.BUTTON_SECONDARY:
            action = pointerOut
            ? options.switcherPopupSecClickOut
            : options.switcherPopupSecClickIn;
            break;
        case Clutter.BUTTON_MIDDLE:
            action = pointerOut
            ? options.switcherPopupMidClickOut
            : options.switcherPopupMidClickIn;
            break;
        default:
            return Clutter.EVENT_PROPAGATE;
        }

        this._triggerAction(action);
        return Clutter.EVENT_STOP;

    }

    vfunc_scroll_event(scrollEvent) {
        let direction = scrollEvent.direction;
        if (direction === Clutter.ScrollDirection.SMOOTH || this._doNotReactOnScroll) {
            this._doNotReactOnScroll = false;
            return;
        }

        this._resetNoModsTimeout();

        const action = this._isPointerOut()
            ? options.switcherPopupScrollOut
            : options.switcherPopupScrollIn;
        this._triggerAction(action, direction);
        return Clutter.EVENT_STOP;
    }

    _getCustomWindowList(allWindows = false) {
        let filterMode;
        if (this._tempFilterMode)
            filterMode = this._tempFilterMode;
        else
            filterMode = this.WIN_FILTER_MODE;

        let workspace = null;
        let ws = global.workspace_manager.get_active_workspace();
        if (filterMode > FilterModes.ALL && !allWindows)
            workspace = ws;


        let winList = AltTab.getWindows(workspace);
        const currentWin = winList[0];

        if (this.WIN_SORTING_MODE === SortingModes.STABLE_SEQUENCE || this.WIN_SORTING_MODE === SortingModes.STABLE_CURRENT_FIRST)
            winList.sort((a, b) => a.get_stable_sequence() - b.get_stable_sequence());


        if (this.WIN_SORTING_MODE === SortingModes.STABLE_CURRENT_FIRST) {
            const currentSq = currentWin.get_stable_sequence();
            winList.sort((a, b, cs = currentSq) => (b.get_stable_sequence() > cs) && (a.get_stable_sequence() <= cs)
                ? 0 : 1
            );
        }

        let monitor = this._monitorIndex;
        // list windows on current monitor only

        if (!allWindows && filterMode === FilterModes.MONITOR && monitor > -1)
            winList = winList.filter(w => w.get_monitor() === monitor);


        if (filterMode === FilterModes.ALL && this.GROUP_MODE === GroupModes.WORKSPACES)
            winList.sort((a, b) => b.get_workspace().index() < a.get_workspace().index());


        if (filterMode === FilterModes.ALL && this.GROUP_MODE === GroupModes.CURRENT_MON_FIRST) {
            // windows from the active workspace and monnitor first
            winList.sort((a, b) =>  (b.get_workspace().index() === ws.index() && b.get_monitor() === monitor) &&
                                  (a.get_workspace().index() !== ws.index() || a.get_monitor() !== monitor));
        }

        if (this.SKIP_MINIMIZED)
            winList = winList.filter(w => !w.minimized);

        if (this._singleApp) {
            SINGLE_APP_PREVIEW_SIZE = this._singleAppPreviewSize;
            if (this._switchNextApp) {
                this._singleApp = this._getNextApp(winList);
                this._switchNextApp = false;
            }
            let tracker = Shell.WindowTracker.get_default();
            winList = winList.filter(w => tracker.get_window_app(w).get_id() === this._singleApp);
        } else {
            SINGLE_APP_PREVIEW_SIZE = 0;
        }

        if (this.GROUP_MODE === GroupModes.APPS) {
            // let apps = _getAppList(winList);
            let apps = _getRunningAppsIds();
            winList.sort((a, b) => apps.indexOf(_getWindowApp(b).get_id()) < apps.indexOf(_getWindowApp(a).get_id()));
        }

        if (this._searchEntry) {
            const filterPatern = (wList, pattern) => {
                return wList.filter(w => {
                // search in window title and app name
                    const appInfo = Shell.WindowTracker.get_default().get_window_app(w).appInfo;
                    let appInfoText = appInfo
                        ? (appInfo.get_name()         ? appInfo.get_name()         : '') +
                          (appInfo.get_generic_name() ? appInfo.get_generic_name() : '') +
                          (appInfo.get_executable()   ? appInfo.get_executable()   : '')
                        : '';
                    return this._match(
                        w.title +
                        appInfoText,
                        pattern);
                });
            };

            let winListP = filterPatern(winList, this._searchEntry);
            // if no window match the pattern, remove the unmatched character
            if (winListP.length === 0 && !this._tempFilterMode) {
                // this._searchEntry = this._searchEntry.slice(0, -1);
                winListP = filterPatern(winList, this._searchEntry);
            }

            winList = winListP;
        }

        if (winList.length)
            this._showingApps = false;

        return winList;
    }

    _getAppList(pattern = '') {
        let filterMode;
        filterMode = this._tempFilterMode
            ? this._tempFilterMode
            : this.APP_FILTER_MODE;

        // pattern can be null
        if (!pattern)
            pattern = '';

        let appList = [];

        const running = Shell.AppSystem.get_default().get_running();
        const runningIds = _getRunningAppsIds();

        let favorites = [];
        let favoritesFull = [];

        if (this.SHOW_APPS && pattern == '') {
            if (this.INCLUDE_FAVORITES) {
                favoritesFull = global.settings.get_strv('favorite-apps');
                favorites = [...favoritesFull];
            }

            // find ids of running apps
            runningIds.forEach(a => {
                const i = favorites.indexOf(a);
                if (i > -1)
                    favorites.splice(i, 1);
            });
            let favList = [...favorites];

            // find app objects for favorites
            favList.forEach(a => {
                const app = Shell.AppSystem.get_default().lookup_app(a);
                if (app)
                    appList.push(app);
            });

            appList = [...running, ...appList];
            // when triggered by a mouse, keep favorites order instead of MRU
            if (!this.KEYBOARD_TRIGGERED || !this._favoritesMRU || this.APP_SORTING_MODE !== AppSortingModes.MRU) {
                this._favoritesMRU = false;
                appList.sort((a, b) => {
                    a = favoritesFull.indexOf(a.get_id());
                    b = favoritesFull.indexOf(b.get_id());
                    return  b > -1 && (b < a || a === -1);
                });

                this._initialSelectionMode = SelectionModes.ACTIVE;
            }
        } else {
            this._initialSelectionMode = SelectionModes.FIRST;
            let appInfoList = Shell.AppSystem.get_default().get_installed().filter(appInfo => {
                try {
                    appInfo.get_id(); // catch invalid file encodings
                } catch (e) {
                    return false;
                }

                return appInfo.should_show() && this._match(
                    (appInfo.get_name()         ? appInfo.get_name()         : '') +
                    (appInfo.get_generic_name() ? appInfo.get_generic_name() : '') +
                    (appInfo.get_executable()   ? appInfo.get_executable()   : ''),
                    pattern);
            });

            for (let i = 0; i < appInfoList.length; i++) {
                let app = _convertAppInfoToShellApp(appInfoList[i]);
                appList.push(app);
            }

            const usage = Shell.AppUsage.get_default();
            // exclude running apps from the search result
            // appList = appList.filter(a => running.indexOf(a.get_id()) === -1);

            // sort apps by usage list
            appList.sort((a, b) => usage.compare(a.get_id(), b.get_id()));
            // limit the app list size
            appList.splice(12);
        }

        let windowTracker = Shell.WindowTracker.get_default();
        if ((filterMode === FilterModes.MONITOR || filterMode === FilterModes.WORKSPACE) && pattern === '') {
            let currentWS = global.workspace_manager.get_active_workspace().index();
            this._tempFilterMode = this.APP_FILTER_MODE;
            appList = appList.filter(a => {
                a.cachedWindows = this._getCustomWindowList().filter(
                   w => windowTracker.get_window_app(w) === a
                );
                return a.cachedWindows.length > 0 || favoritesFull.indexOf(a.get_id()) > -1;
            });
        } else {
            appList.forEach(
                a => a.cachedWindows = this._getCustomWindowList().filter(
                    w => windowTracker.get_window_app(w) === a
                )
            );
        }

        if (appList.length)
            this._showingApps = true;

        return appList;
    }
});

var WindowIcon = GObject.registerClass(
class WindowIcon extends St.BoxLayout {
    _init(item, iconIndex) {
        super._init({
            style_class: 'alt-tab-app',
            vertical: true,
            reactive: true,
        });
        this._icon = new St.Widget({layout_manager: new Clutter.BinLayout()});

        this.add_child(this._icon);
        this._icon.destroy_all_children();

        if (item.get_title)
            this._createWindowIcon(item, iconIndex);
        else
            this._createAppLauncherIcon(item, iconIndex);

        if (showHotKeys && HOT_KEYS && iconIndex < 12)
            this._icon.add_actor(_createHotKeyNumIcon(iconIndex));
    }

    _createWindowIcon(window, iconIndex) {
        this.is_window = true;

        this.window = window;

        this.ilabel = new St.Label({text: window.get_title()});

        let tracker = Shell.WindowTracker.get_default();
        this.app = tracker.get_window_app(window);

        let mutterWindow = this.window.get_compositor_private();

        let scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;

        let switched = false;
        let size, cloneSize;

        size = SINGLE_APP_PREVIEW_SIZE ? SINGLE_APP_PREVIEW_SIZE : WINDOW_PREVIEW_SIZE;
        cloneSize = size;

        if (!SINGLE_APP_PREVIEW_SIZE && APP_ICON_SIZE > WINDOW_PREVIEW_SIZE) {
            size = APP_ICON_SIZE;
            switched = true;
            cloneSize = Math.floor((mutterWindow.width / mutterWindow.height) * WINDOW_PREVIEW_SIZE);
        }

        let clone = AltTab._createWindowClone(mutterWindow, cloneSize * scaleFactor);
        let icon;
        if (this.app) {
            icon = this._createAppIcon(this.app,
                APP_ICON_SIZE);
        }
        let base, front;
        if (switched) {
            base  = icon;
            front = clone;
        } else {
            base  = clone;
            front = icon;
        }

        if (this.window.minimized)
            front.opacity = 80;

        this._alignFront(front);

        this._icon.add_actor(base);
        this._icon.add_actor(front);

        if (WS_INDEXES)
            this._icon.add_actor(this._createWsIcon(window.get_workspace().index() + 1));

        if (this.window.is_on_all_workspaces())
            this._icon.add_actor(this._createStickyIcon());

        this._icon.set_size(size * scaleFactor, size * scaleFactor);
    }

    _createAppLauncherIcon(app, iconIndex) {
        this.is_window = false;
        this.app = app;
        this.ilabel = new St.Label({text: this.app.get_name()});

        let icon = app.create_icon_texture(APP_MODE_ICON_SIZE);
        this._icon.add_actor(icon);

        let scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        let winCount = app.cachedWindows.length;

        if (winCount > 0) {
            let mutterWindow = app.get_windows()[0].get_compositor_private();
            let cloneSize = Math.floor((mutterWindow.width / mutterWindow.height) * WINDOW_PREVIEW_SIZE / 3);
            let clone = AltTab._createWindowClone(mutterWindow, cloneSize * scaleFactor);
            this._icon.add_actor(clone);
            this._alignFront(clone, false);
        }

        winCount > 0 && this._icon.add_actor(this._createRunningIndicator(winCount));
    }

    _alignFront(icon, isWindow = true) {
        icon.x_align = icon.y_align = Clutter.ActorAlign.END;
        if (isWindow && this.window.is_above())
            icon.y_align = Clutter.ActorAlign.START;
    }

    _createAppIcon(app, size) {
        let appIcon = app
            ? app.create_icon_texture(size)
            : new St.Icon({icon_name: 'icon-missing', icon_size: size});
        appIcon.x_expand = appIcon.y_expand = true;
        return appIcon;
    }

    _createWsIcon(index) {
        let currentWS = global.workspace_manager.get_active_workspace().index();
        let icon = new St.Widget({
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.END,
        });

        let label = new St.Label({
            text: index.toString(),
            style_class: currentWS + 1 === index ? 'workspace-index-highlight' : 'workspace-index',
        });
        icon.add_actor(label);
        return icon;
    }

    _createStickyIcon() {
        let icon = new St.Widget({
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.START,
        });
        let iconF = new St.Icon({
            style_class: 'workspace-index',
            icon_name: 'view-pin-symbolic',
            icon_size: 16,
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        icon.add_actor(iconF);
        return icon;
    }
});

var AppIcon = GObject.registerClass(
class AppIcon extends Dash.DashIcon {
    _init(app, iconIndex, params = {}) {
        super._init(app, params);
        this.ilabel = new St.Label({text: app.get_name()});
        // disable original app icon style
        this.style_class = '';
        this._iconContainer.remove_child(this._dot);

        const c = app.cachedWindows.length;
        if (c)
            this._iconContainer.add_child(this._createRunningIndicator(c));

        if (showHotKeys && HOT_KEYS && iconIndex < 12)
            this._iconContainer.add_child(_createHotKeyNumIcon(iconIndex));
    }

    _createIcon(iconSize) {
        return this.app.create_icon_texture(APP_MODE_ICON_SIZE);
    }

    _createRunningIndicator(num) {
        let currentWS = global.workspace_manager.get_active_workspace().index();
        let icon = new St.Widget({
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.END,
        });

        let label = new St.Label({
            text: num.toString(),
            style_class: 'workspace-index',
        });
        icon.add_actor(label);
        //box.add(label);

        return icon;
    }

    vfunc_button_press_event(buttonEvent) {
        return Clutter.EVENT_PROPAGATE;
    /*    super.vfunc_button_press_event(buttonEvent);
        if (buttonEvent.button == 1) {
            this._setPopupTimeout();
        } else if (buttonEvent.button == 3) {
            this.popupMenu();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE; */
    }

    /*    vfunc_scroll_event(scrollEvent) {
        // disable the feature for now
        return;

        let direction = scrollEvent.direction;

        return this._switchWindow(direction);
    }

    _switchWindow(direction) {
        if (direction == Clutter.ScrollDirection.SMOOTH) return;

        let maxIndex = this.app.cachedWindows.length - 1;
        let step;
        direction == Clutter.ScrollDirection.UP ?
            step = - 1 :
            step =   1 ;
        if (this.app.state != Shell.AppState.RUNNING || this.app.cachedWindows.length == 0)
            return Clutter.EVENT_PROPAGATE;

        let wins = [...this.app.cachedWindows];

        let focusedWin = global.display.get_tab_list(Meta.TabList.NORMAL, null)[0];
        let lastUsedAppWin = this.app.cachedWindows[0];
        let focused = lastUsedAppWin == focusedWin;

        let idx;
        if (this.idx)
            idx = this.idx;
        else {
            idx = wins.indexOf(lastUsedAppWin);
        }

        wins.sort((a, b) => a.get_stable_sequence() > b.get_stable_sequence());
        if (!focused) {
            //this._showWindow(lastUsedAppWin);
            Main.activateWindow(lastUsedAppWin);
            this.idx = idx;

            return Clutter.EVENT_STOP;

        } else {
            // store index for the switcher
            idx += step;
            if (idx < 0) idx = maxIndex;
            else if (idx > maxIndex) idx = 0;
            this.idx = idx;
            let win = wins[idx];

            // don't activate the window, only show it, to kepp the original sequence
            // window will be activated on popup hide
            //this._showWindow(win);
            Main.activateWindow(wins[idx]);

            return Clutter.EVENT_STOP;
        }
    }
*/
    _showWindow(win) {
        let a = win.above;
        win.make_above();
        a ? win.make_above() : win.unmake_above();
        Main.wm.actionMoveWorkspace(win.get_workspace());
    }
});

var WindowSwitcher = GObject.registerClass(
class WindowSwitcher extends AltTab.SwitcherPopup.SwitcherList {
    _init(windows) {
        super._init(true);
        this._statusLabel = new St.Label({
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'status-label',
        });
        this._statusLabel.set_text('Filter: Order:'); // this text will be replaced immediately
        if (INFO)
            this.add_actor(this._statusLabel);
        this._label = new St.Label({
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_actor(this._label);

        this.windows = windows;
        this.icons = [];

        for (let i = 0; i < windows.length; i++) {
            let win = windows[i];
            let icon;
            if (win.get_title) {
                icon = new WindowIcon(win, i);
            } else {
                icon = new AppIcon(win, i);
                icon.connect('menu-state-changed',
                    (o, opened) => {
                        _cancelTimeout = opened;
                    });
            }

            this.addItem(icon, icon.ilabel);
            this.icons.push(icon);

            // the icon could be an app, not just a window
            if (icon.is_window) {
                icon._unmanagedSignalId = icon.window.connect('unmanaged', window => {
                    this._removeWindow(window);
                });
            }
        }

        this.connect('destroy', this._onDestroy.bind(this));
    }

    _onDestroy() {
        this.icons.forEach(icon => {
            if (icon.window)
                icon.window.disconnect(icon._unmanagedSignalId);
        });
    }

    vfunc_get_preferred_height(forWidth) {
        let [minHeight, natHeight] = super.vfunc_get_preferred_height(forWidth);

        let spacing = this.get_theme_node().get_padding(St.Side.BOTTOM);
        let [labelMin, labelNat] = this._label.get_preferred_height(-1);

        let multiplier = 0;
        multiplier += INFO ? 1 : 0;
        multiplier += this._parent.OVERLAY_TITLE ? 0 : 1;
        minHeight += multiplier * labelMin + spacing;
        natHeight += multiplier * labelNat + spacing;

        return [minHeight, natHeight];
    }

    vfunc_allocate(box, flags) {
        let themeNode = this.get_theme_node();
        let contentBox = themeNode.get_content_box(box);
        let labelHeight = this._parent.OVERLAY_TITLE ? 0 : this._label.height;
        // labelHeight = this._label.height;
        const labelHeightF = INFO ? this._statusLabel.height : 0;
        const totalLabelHeight =
            labelHeightF + labelHeight + themeNode.get_padding(St.Side.BOTTOM);

        box.y2 -= totalLabelHeight;
        GNOME40 ? super.vfunc_allocate(box)
            : super.vfunc_allocate(box, flags);

        // Hooking up the parent vfunc will call this.set_allocation() with
        // the height without the label height, so call it again with the
        // correct size here.
        box.y2 += totalLabelHeight;
        GNOME40 ? this.set_allocation(box)
            : this.set_allocation(box, flags);

        const childBox = new Clutter.ActorBox();
        childBox.x1 = contentBox.x1;
        childBox.x2 = contentBox.x2;
        childBox.y2 = contentBox.y2 - labelHeightF;
        childBox.y1 = childBox.y2 - labelHeight - labelHeightF;
        if (!this.OVERLAY_TITLE) {
            GNOME40 ? this._label.allocate(childBox)
                : this._label.allocate(childBox, flags);
        }
        const childBoxF = new Clutter.ActorBox();
        childBoxF.x1 = contentBox.x1;
        childBoxF.x2 = contentBox.x2;
        childBoxF.y2 = contentBox.y2;
        childBoxF.y1 = childBoxF.y2 - labelHeightF;
        if (INFO) {
            GNOME40 ? this._statusLabel.allocate(childBoxF)
                : this._statusLabel.allocate(childBoxF, flags);
        }
    }

    highlight(index, justOutline) {
        super.highlight(index, justOutline);
        this._label.set_text(index == -1 ? '' : this.icons[index].ilabel.text);
    }

    _removeWindow(window) {
        let index = this.icons.findIndex(icon => {
            return icon.window == window;
        });
        if (index === -1)
            return;

        this.icons.splice(index, 1);
        this.removeItem(index);
    }
});

// icon indicating direct activation key
function _createHotKeyNumIcon(index) {
    let icon = new St.Widget({
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.START,
        y_align: Clutter.ActorAlign.START,
    });

    let box = new St.BoxLayout({
        style_class: 'hot-key-number',
        vertical: true,
    });

    icon.add_actor(box);
    let label = new St.Label({text: `F${(index + 1).toString()}`});
    box.add(label);

    return icon;
}

var   AppSwitcherPopup = GObject.registerClass(
class AppSwitcherPopup extends WindowSwitcherPopup {
    _init() {
        super._init();
        this._switcherMode = SwitcherModes.APPS;
        this.SHOW_APPS = true;
    }
});
