interface SectionHeadingProps {
  index: string;
  title: string;
  detail?: string;
}

export function SectionHeading({ detail, index, title }: SectionHeadingProps) {
  return (
    <div className="section-heading">
      <span>{index}</span>
      <div>
        <h2>{title}</h2>
        {detail ? <p>{detail}</p> : null}
      </div>
    </div>
  );
}
