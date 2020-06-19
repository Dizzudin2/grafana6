// Libaries
import React, { PureComponent } from 'react';
import { hot } from 'react-hot-loader';
import ReactGridLayout, { ItemCallback } from 'react-grid-layout';
import classNames from 'classnames';
// @ts-ignore
import sizeMe from 'react-sizeme';

// Types
import { GRID_CELL_HEIGHT, GRID_CELL_VMARGIN, GRID_COLUMN_COUNT } from 'app/core/constants';
import { DashboardPanel } from './DashboardPanel';
import { DashboardModel, PanelModel } from '../state';
import { CoreEvents } from 'app/types';
import { PanelEvents } from '@grafana/data';
import { panelAdded, panelRemoved } from '../state/PanelModel';
// import { css, cx } from 'emotion';

let lastGridWidth = 1200;
let ignoreNextWidthChange = false;

interface GridWrapperProps {
  size: { width: number };
  layout: ReactGridLayout.Layout[];
  onLayoutChange: (layout: ReactGridLayout.Layout[]) => void;
  children: JSX.Element | JSX.Element[];
  onDragStop: ItemCallback;
  onResize: ItemCallback;
  onResizeStop: ItemCallback;
  onWidthChange: () => void;
  className: string;
  isResizable?: boolean;
  isDraggable?: boolean;
  isFullscreen?: boolean;
}

function GridWrapper({
  size,
  layout,
  onLayoutChange,
  children,
  onDragStop,
  onResize,
  onResizeStop,
  onWidthChange,
  className,
  isResizable,
  isDraggable,
  isFullscreen,
}: GridWrapperProps) {
  const width = size.width > 0 ? size.width : lastGridWidth;

  // logic to ignore width changes (optimization)
  if (width !== lastGridWidth) {
    if (ignoreNextWidthChange) {
      ignoreNextWidthChange = false;
    } else if (!isFullscreen && Math.abs(width - lastGridWidth) > 8) {
      onWidthChange();
      lastGridWidth = width;
    }
  }

  /*
    Disable draggable if mobile device, solving an issue with unintentionally
     moving panels. https://github.com/grafana/grafana/issues/18497
  */
  const draggable = width <= 420 ? false : isDraggable;

  return (
    <ReactGridLayout
      width={lastGridWidth}
      className={className}
      isDraggable={draggable}
      isResizable={isResizable}
      containerPadding={[0, 0]}
      useCSSTransforms={false}
      margin={[GRID_CELL_VMARGIN, GRID_CELL_VMARGIN]}
      cols={GRID_COLUMN_COUNT}
      rowHeight={GRID_CELL_HEIGHT}
      draggableHandle=".grid-drag-handle"
      layout={layout}
      onResize={onResize}
      onResizeStop={onResizeStop}
      onDragStop={onDragStop}
      onLayoutChange={onLayoutChange}
    >
      {children}
    </ReactGridLayout>
  );
}

const SizedReactLayoutGrid = sizeMe({ monitorWidth: true })(GridWrapper);

export interface Props {
  dashboard: DashboardModel;
  isEditing: boolean;
  isFullscreen: boolean;
  scrollTop: number;
}

export interface State {
  layouts: ReactGridLayout.Layout[];
  gridPos: ReactGridLayout.Layout;
}

export class DashboardGrid extends PureComponent<Props, State> {
  panelMap: { [id: string]: PanelModel };
  panelRef: { [id: string]: HTMLElement } = {};

  componentDidMount() {
    const { dashboard } = this.props;
    dashboard.on(panelAdded, this.triggerForceUpdate);
    dashboard.on(panelRemoved, this.triggerForceUpdate);
    dashboard.on(CoreEvents.repeatsProcessed, this.triggerForceUpdate);
    dashboard.on(PanelEvents.viewModeChanged, this.onViewModeChanged);
    dashboard.on(CoreEvents.rowCollapsed, this.triggerForceUpdate);
    dashboard.on(CoreEvents.rowExpanded, this.triggerForceUpdate);
  }

  componentWillUnmount() {
    const { dashboard } = this.props;
    dashboard.off(panelAdded, this.triggerForceUpdate);
    dashboard.off(panelRemoved, this.triggerForceUpdate);
    dashboard.off(CoreEvents.repeatsProcessed, this.triggerForceUpdate);
    dashboard.off(PanelEvents.viewModeChanged, this.onViewModeChanged);
    dashboard.off(CoreEvents.rowCollapsed, this.triggerForceUpdate);
    dashboard.off(CoreEvents.rowExpanded, this.triggerForceUpdate);
  }

  buildLayout() {
    const layout = [];
    this.panelMap = {};

    for (const panel of this.props.dashboard.panels) {
      const stringId = panel.id.toString();
      this.panelMap[stringId] = panel;

      if (!panel.gridPos) {
        console.log('panel without gridpos');
        continue;
      }

      const panelPos: any = {
        i: stringId,
        x: panel.gridPos.x,
        y: panel.gridPos.y,
        w: panel.gridPos.w,
        h: panel.gridPos.h,
      };

      if (panel.type === 'row') {
        panelPos.w = GRID_COLUMN_COUNT;
        panelPos.h = 1;
        panelPos.isResizable = false;
        panelPos.isDraggable = panel.collapsed;
      }

      layout.push(panelPos);
    }

    return layout;
  }

  onLayoutChange = (newLayout: ReactGridLayout.Layout[]) => {
    for (const newPos of newLayout) {
      this.panelMap[newPos.i].updateGridPos(newPos);
    }

    this.props.dashboard.sortPanelsByGridPos();

    // Call render() after any changes.  This is called when the layour loads
    this.forceUpdate();
  };

  triggerForceUpdate = () => {
    this.forceUpdate();
  };

  onWidthChange = () => {
    for (const panel of this.props.dashboard.panels) {
      panel.resizeDone();
    }
    this.forceUpdate();
  };

  onViewModeChanged = () => {
    ignoreNextWidthChange = true;
  };

  updateGridPos = (item: ReactGridLayout.Layout, layout: ReactGridLayout.Layout[]) => {
    this.panelMap[item.i].updateGridPos(item);

    // react-grid-layout has a bug (#670), and onLayoutChange() is only called when the component is mounted.
    // So it's required to call it explicitly when panel resized or moved to save layout changes.
    this.onLayoutChange(layout);
  };

  onResize: ItemCallback = (layout, oldItem, newItem, lol, lol2, lol3,) => {
    this.panelMap[newItem.i].updateGridPos(newItem);
  };

  onResizeStop: ItemCallback = (layout, oldItem, newItem) => {
    this.updateGridPos(newItem, layout);
    this.panelMap[newItem.i].resizeDone();
  };

  onDragStop: ItemCallback = (layout, oldItem, newItem) => {
    this.updateGridPos(newItem, layout);
  };

  isInView = (panel: PanelModel): boolean => {
    if (panel.fullscreen || panel.isEditing) {
      return true;
    }

    // elem is set *after* the first render
    const elem = this.panelRef[panel.id.toString()];
    if (!elem) {
      // NOTE the gridPos is also not valid until after the first render
      // since it is passed to the layout engine and made to be valid
      // for example, you can have Y=0 for everything and it will stack them
      // down vertically in the second call
      return false;
    }

    const top = elem.offsetTop;
    const height = panel.gridPos.h * GRID_CELL_HEIGHT + 40;
    const bottom = top + height;

    // Show things that are almost in the view
    const buffer = 250;

    const viewTop = this.props.scrollTop;
    if (viewTop > bottom + buffer) {
      return false; // The panel is above the viewport
    }

    // Use the whole browser height (larger than real value)
    // TODO? is there a better way
    const viewHeight = isNaN(window.innerHeight) ? (window as any).clientHeight : window.innerHeight;
    const viewBot = viewTop + viewHeight;
    if (top > viewBot + buffer) {
      return false;
    }

    return !this.props.dashboard.otherPanelInFullscreen(panel);
  };

  handleHoverIn = (id: string, event: any ) => {
    const { dashboard } = this.props;
    const layout = this.buildLayout();
    const element = this.panelRef[id];
    const newItem = layout.find(item => item.i === id);
    const prevState = Object.assign({}, newItem);;

    if ((newItem.x + (newItem.w)*(dashboard.dynamicView.horizontal)) > 24) {
      newItem.x = 24 - (dashboard.dynamicView.horizontal)*(newItem.w);
      newItem.y = newItem.y - 0.000001;
      newItem.h = newItem.h * dashboard.dynamicView.vertical;
      newItem.w = newItem.w * dashboard.dynamicView.horizontal;
    }else {
      newItem.h = newItem.h * dashboard.dynamicView.vertical;
      newItem.w = newItem.w * dashboard.dynamicView.horizontal;
    }

    this.onResizeStop(layout, newItem, newItem, newItem, event, element);
    this.setState({ layouts: layout, gridPos: prevState });
  };

  handleHoverOut = (id: string, event: any ) => {
    const { dashboard } = this.props;
    const prevLayout = this.state.layouts;
    const newItem = prevLayout.find(item => item.i === id);
    const element = this.panelRef[id];
    const prevState = this.state.gridPos;

    newItem.x = prevState.x;
    newItem.y = prevState.y;
    newItem.h = prevState.h;
    newItem.w = prevState.w;

    this.onResizeStop(prevLayout, newItem, newItem, newItem, event, element);
    this.setState({ layouts: [] , gridPos: {x:0,y:0,h:0,w:0} });
  };

  // sortPanel = (id: string) => {
  //   const panels = [];
  // }

  renderPanels() {
    const panelElements = [];
    if (this.props.dashboard.dynamicView.enable) {
      for (const panel of this.props.dashboard.panels) {
        const panelClasses = classNames({ 'react-grid-item--fullscreen': panel.fullscreen});
        const id = panel.id.toString();
        panel.isInView = this.isInView(panel);

        panelElements.push(
          <div
            key={id}
            className={panelClasses}
            id={'panel-' + id}
            ref={elem => {
              this.panelRef[id] = elem;
            }}
            onMouseEnter={ (event) => {this.handleHoverIn(id, event );} }
            onMouseLeave={ (event) => {this.handleHoverOut(id, event );}  }
          >
            <DashboardPanel
              panel={panel}
              dashboard={this.props.dashboard}
              isEditing={panel.isEditing}
              isFullscreen={panel.fullscreen}
              isInView={panel.isInView}
            />
          </div>
        );
      }

    }else {
      for (const panel of this.props.dashboard.panels) {
        const panelClasses = classNames({ 'react-grid-item--fullscreen': panel.fullscreen});
        const id = panel.id.toString();
        panel.isInView = this.isInView(panel);

        panelElements.push(
          <div
            key={id}
            className={panelClasses}
            id={'panel-' + id}
            ref={elem => {
              this.panelRef[id] = elem;
            }}
          >
            <DashboardPanel
              panel={panel}
              dashboard={this.props.dashboard}
              isEditing={panel.isEditing}
              isFullscreen={panel.fullscreen}
              isInView={panel.isInView}
            />
          </div>
        );
      }
    }
    return panelElements;
  }

  render() {
    const { dashboard, isFullscreen } = this.props;

    return (
      <SizedReactLayoutGrid
        className={classNames({ layout: true })}
        layout={this.buildLayout()}
        isResizable={dashboard.meta.canEdit}
        isDraggable={dashboard.meta.canEdit}
        onLayoutChange={this.onLayoutChange}
        onWidthChange={this.onWidthChange}
        onDragStop={this.onDragStop}
        onResize={this.onResize}
        onResizeStop={this.onResizeStop}
        isFullscreen={isFullscreen}
      >
        {this.renderPanels()}
      </SizedReactLayoutGrid>
    );
  }
}

export default hot(module)(DashboardGrid);
