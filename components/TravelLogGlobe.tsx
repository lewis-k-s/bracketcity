import React, { useMemo, useState } from "react";
import DeckGL from "@deck.gl/react";
import { _GlobeView as GlobeView } from "@deck.gl/core";
import type { Color, Layer, PickingInfo, Position } from "@deck.gl/core";
import { ArcLayer, ScatterplotLayer, BitmapLayer } from "@deck.gl/layers";
import { TileLayer } from "@deck.gl/geo-layers";
import "./TravelLogGlobe.css";

export interface TravelPhoto {
  readonly url: string;
  readonly alt?: string;
  readonly caption?: string;
}

export interface TravelPoint {
  readonly id: string;
  readonly title: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly date?: string;
  readonly description?: string;
  readonly photos?: readonly TravelPhoto[];
}

interface TravelArc {
  readonly sourcePosition: Position;
  readonly targetPosition: Position;
  readonly source: TravelPoint;
  readonly target: TravelPoint;
}

export interface TravelGlobeColors {
  readonly arc: Color;
  readonly node: Color;
  readonly nodeSelected: Color;
}

export interface TravelLogGlobeProps {
  readonly data?: readonly TravelPoint[];
  readonly mapboxToken?: string;
  readonly mapStyle?: string;
  readonly colors?: TravelGlobeColors;
  readonly onNodeSelect?: (point: TravelPoint) => void;
}

const DEFAULT_VIEW_STATE = {
  latitude: 20,
  longitude: 0,
  zoom: 0.7,
  minZoom: 0.3,
  maxZoom: 3.5
};

const DEFAULT_COLORS: TravelGlobeColors = {
  arc: [255, 160, 90],
  node: [255, 255, 255],
  nodeSelected: [255, 90, 90]
};

const toArcData = (points: readonly TravelPoint[]): TravelArc[] => {
  if (!Array.isArray(points) || points.length < 2) return [];
  return points.slice(1).map((point, index) => {
    const prev = points[index];
    return {
      sourcePosition: [prev!.longitude, prev!.latitude],
      targetPosition: [point.longitude, point.latitude],
      source: prev!,
      target: point
    };
  });
};

const isValidToken = (token: string): boolean => token.trim().length > 0;

export default function TravelLogGlobe({
  data = [],
  mapboxToken = "",
  mapStyle = "mapbox/satellite-v9",
  colors = DEFAULT_COLORS,
  onNodeSelect
}: TravelLogGlobeProps): React.JSX.Element {
  const [selected, setSelected] = useState<TravelPoint | null>(null);

  const arcData = useMemo(() => toArcData(data), [data]);

  const handleSelect = (info: PickingInfo<TravelPoint>): void => {
    if (!info?.object) return;
    const selection = info.object;
    setSelected(selection);
    if (typeof onNodeSelect === "function") onNodeSelect(selection);
  };

  const layers = useMemo(() => {
    const baseLayers: Layer[] = [];

    if (isValidToken(mapboxToken)) {
      baseLayers.push(
        new TileLayer<string>({
          id: "mapbox-tiles",
          data: `https://api.mapbox.com/styles/v1/${mapStyle}/tiles/256/{z}/{x}/{y}@2x?access_token=${mapboxToken}`,
          minZoom: 0,
          maxZoom: 5,
          tileSize: 256,
          renderSubLayers: (props) => {
            const { bbox } = props.tile;
            if (!("west" in bbox)) return null;
            const { west, south, east, north } = bbox;
            return new BitmapLayer({
              id: `${props.id}-bitmap`,
              image: props.data,
              bounds: [west, south, east, north]
            });
          }
        })
      );
    }

    baseLayers.push(
      new ArcLayer<TravelArc>({
        id: "travel-arcs",
        data: arcData,
        getSourcePosition: (d) => d.sourcePosition,
        getTargetPosition: (d) => d.targetPosition,
        getSourceColor: colors.arc,
        getTargetColor: colors.arc,
        getWidth: 2,
        greatCircle: true
      }),
      new ScatterplotLayer<TravelPoint>({
        id: "travel-nodes",
        data,
        pickable: true,
        radiusUnits: "pixels",
        getRadius: (d) => (selected?.id === d.id ? 10 : 6),
        getFillColor: (d) => (selected?.id === d.id ? colors.nodeSelected : colors.node),
        getPosition: (d) => [d.longitude, d.latitude],
        onClick: handleSelect
      })
    );

    return baseLayers;
  }, [arcData, colors.arc, colors.node, colors.nodeSelected, data, mapStyle, mapboxToken, selected?.id]);

  return (
    <div className="travel-log-globe">
      {!isValidToken(mapboxToken) && (
        <div className="travel-log-globe__notice">
          Provide a Mapbox token to render the base map.
        </div>
      )}
      <DeckGL
        views={new GlobeView()}
        layers={layers}
        controller
        initialViewState={DEFAULT_VIEW_STATE}
      />
      {selected && (
        <div className="travel-log-globe__popup">
          <div className="travel-log-globe__popup-header">
            <div>
              <div className="travel-log-globe__title">{selected.title}</div>
              {selected.date && (
                <div className="travel-log-globe__date">{selected.date}</div>
              )}
            </div>
            <button
              className="travel-log-globe__close"
              type="button"
              onClick={() => setSelected(null)}
              aria-label="Close"
            >
              ×
            </button>
          </div>
          {selected.description && (
            <p className="travel-log-globe__description">{selected.description}</p>
          )}
          {Array.isArray(selected.photos) && selected.photos.length > 0 ? (
            <div className="travel-log-globe__photos">
              {selected.photos.map((photo, index) => (
                <figure key={`${selected.id}-${index}`}>
                  <img src={photo.url} alt={photo.alt || selected.title} />
                  {photo.caption && <figcaption>{photo.caption}</figcaption>}
                </figure>
              ))}
            </div>
          ) : (
            <div className="travel-log-globe__empty">No photos yet.</div>
          )}
        </div>
      )}
    </div>
  );
}
