CREATE TABLE "product_image_attribute_values" (
	"image_id" uuid NOT NULL,
	"attribute_id" uuid NOT NULL,
	"value_id" uuid NOT NULL,
	CONSTRAINT "product_image_attribute_values_image_id_attribute_id_pk" PRIMARY KEY("image_id","attribute_id")
);
--> statement-breakpoint
ALTER TABLE "product_image_attribute_values" ADD CONSTRAINT "product_image_attribute_values_image_id_product_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."product_images"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_image_attribute_values" ADD CONSTRAINT "product_image_attribute_values_attribute_id_attributes_id_fk" FOREIGN KEY ("attribute_id") REFERENCES "public"."attributes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_image_attribute_values" ADD CONSTRAINT "product_image_attribute_values_value_id_attribute_values_id_fk" FOREIGN KEY ("value_id") REFERENCES "public"."attribute_values"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_image_attr_value_idx" ON "product_image_attribute_values" USING btree ("value_id");