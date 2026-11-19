import { useCallback, useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import "./TailoringOrbitGallery.css";

const wrap = (value, length) => ((value % length) + length) % length;

// Signed circular offset: -1 is the previous card, +1 is the next card.
function circularOffset(index, active, length) {
  let offset = wrap(index - active, length);
  if (offset > Math.floor(length / 2)) offset -= length;
  return offset;
}

/**
 * @param {{
 *   items: Array<{id: string, title: string, category: string, image: string, alt?: string, description?: string}>,
 *   onRequestOutfit?: (item: object) => void,
 *   heading?: string,
 * }} props
 * Pass onRequestOutfit using the project's EXISTING WhatsApp utility.
 */
export default function TailoringOrbitGallery({
  items = [],
  onRequestOutfit,
  renderRequest,
  heading = "Crafted for your story.",
}) {
  const [active, setActive] = useState(0);
  const [failedImages, setFailedImages] = useState({});
  const reduceMotion = useReducedMotion();
  const length = items.length;
  const current = items[wrap(active, Math.max(length, 1))];

  useEffect(() => {
    setActive((previous) => (length ? wrap(previous, length) : 0));
  }, [length]);

  const move = useCallback(
    (direction) => {
      if (length > 1) setActive((previous) => wrap(previous + direction, length));
    },
    [length]
  );

  function onKeyDown(event) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      move(1);
    } else if (event.key === "Home" && length) {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End" && length) {
      event.preventDefault();
      setActive(length - 1);
    }
  }

  if (!length) return null;

  return (
    <section className="mcl-orbit" aria-label="McLily custom tailoring portfolio">
      <div className="mcl-orbit__topline">
        <div>
          <p className="mcl-orbit__eyebrow">THE McLILY ATELIER / STYLE EXPLORER</p>
          <h2 className="mcl-orbit__title">{heading}</h2>
          <p className="mcl-orbit__intro">Explore the silhouettes. Find a look you love, then tell us how you’d make it yours. Editorial inspiration, ready for your own interpretation.</p>
        </div>
        <span className="mcl-orbit__count" aria-label={`Look ${active + 1} of ${length}`}>
          {String(active + 1).padStart(2, "0")} <span>/</span> {String(length).padStart(2, "0")}
        </span>
      </div>

      <div className="mcl-orbit__viewport" tabIndex={0} onKeyDown={onKeyDown}
        role="region" aria-roledescription="carousel" aria-label="Tailoring looks. Use left and right arrow keys to browse.">
        <motion.div
          className="mcl-orbit__stage"
          drag={length > 1 ? "x" : false}
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.15}
          dragMomentum={false}
          onDragEnd={(_event, info) => {
            // Direction determined by swipe distance or velocity; one look per swipe.
            if (info.offset.x < -65 || info.velocity.x < -400) move(1);
            else if (info.offset.x > 65 || info.velocity.x > 400) move(-1);
          }}
        >
          {items.map((item, index) => {
            const offset = circularOffset(index, active, length);
            const visible = Math.abs(offset) <= 2;
            const selected = offset === 0;
            // x is relative to the viewport; keep center card prominent.
            const x = offset === 0 ? "0%" : `${offset * 59}%`;
            return (
              <motion.button
                key={item.id}
                type="button"
                className="mcl-orbit__look"
                onClick={() => !selected && setActive(index)}
                animate={{
                  x,
                  rotateY: reduceMotion ? 0 : -offset * 24,
                  scale: selected ? 1 : Math.max(0.72, 0.88 - Math.abs(offset) * 0.08),
                  opacity: visible ? (selected ? 1 : Math.abs(offset) === 1 ? 0.78 : 0.28) : 0,
                  filter: selected ? "brightness(1)" : "brightness(.74)",
                }}
                initial={false}
                transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 220, damping: 30 }}
                style={{ zIndex: 10 - Math.abs(offset), pointerEvents: visible && !selected ? "auto" : "none" }}
                tabIndex={visible && !selected ? 0 : -1}
                aria-label={`${selected ? 'Current look' : 'Show'}: ${item.title}`}
                aria-current={selected ? 'true' : undefined}
                aria-hidden={!visible ? true : undefined}
              >
                {item.image && !failedImages[item.id] ? (
                  <img src={item.image} alt={item.alt || item.title} loading={selected ? "eager" : "lazy"}
                    draggable="false" style={{objectPosition: item.objectPosition || 'center'}} onError={() => setFailedImages((old) => ({ ...old, [item.id]: true }))} />
                ) : (
                  <div className="mcl-orbit__image-fallback" aria-hidden="true">McLily <small>{item.title}</small></div>
                )}
                <span className="mcl-orbit__look-label">{item.category}</span>
              </motion.button>
            );
          })}
        </motion.div>

        <div className="mcl-orbit__controls" aria-label="Gallery controls">
          <button type="button" onClick={() => move(-1)} aria-label="Previous look" disabled={length < 2}>←</button>
          <span>Swipe or use arrows</span>
          <button type="button" onClick={() => move(1)} aria-label="Next look" disabled={length < 2}>→</button>
        </div>
      </div>

      <div className="mcl-orbit__detail" aria-live="polite" aria-atomic="true">
        <div>
          <p className="mcl-orbit__eyebrow">{current.category}</p>
          <h3>{current.title}</h3>
          {current.description && <p>{current.description}</p>}
        </div>
        {renderRequest ? renderRequest(current) : onRequestOutfit && (
          <button className="mcl-orbit__cta" type="button" onClick={() => onRequestOutfit(current)}>
            Request something similar <span aria-hidden="true">↗</span>
          </button>
        )}
      </div>
      {length > 1 && (
        <div className="mcl-orbit__dots" aria-label="Choose a look">
          {items.map((item, index) => (
            <button type="button" key={item.id} onClick={() => setActive(index)}
              aria-label={`Go to look ${index + 1}: ${item.title}`}
              aria-current={index === active ? "true" : undefined}
              className={index === active ? "is-active" : ""} />
          ))}
        </div>
      )}
    </section>
  );
}
